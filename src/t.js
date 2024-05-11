import "dotenv/config";
import Binance from "node-binance-api";
import http from "http";

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      data: "Hello World!",
    })
  );
});
server.listen(process.env.PORT);

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;

const binance = new Binance().options({
  APIKEY: apiKey,
  APISECRET: apiSecret,
  test: true,
  reconnect: true,
  family: 6,
  useServerTime: true,
});

// Order Update: {
//     eventType: 'ORDER_TRADE_UPDATE',
//     eventTime: 1715439797968,
//     transaction: 1715439797967,
//     order: {
//       symbol: 'BTCUSDT',
//       clientOrderId: 'WwcyugjsH9VRLogsFkjy87',
//       side: 'BUY',
//       orderType: 'MARKET',
//       timeInForce: 'GTC',
//       originalQuantity: '0.002',
//       originalPrice: '0',
//       averagePrice: '61280.60000',
//       stopPrice: '61200',
//       executionType: 'TRADE',
//       orderStatus: 'FILLED',
//       orderId: 4035691632,
//       orderLastFilledQuantity: '0.002',
//       orderFilledAccumulatedQuantity: '0.002',
//       lastFilledPrice: '61280.60',
//       commissionAsset: 'USDT',
//       commission: '0.04902448',
//       orderTradeTime: 1715439797967,
//       tradeId: 285273915,
//       bidsNotional: '0',
//       askNotional: '0',
//       isMakerSide: false,
//       isReduceOnly: false,
//       stopPriceWorkingType: 'CONTRACT_PRICE',
//       originalOrderType: 'STOP_MARKET',
//       positionSide: 'BOTH',
//       closeAll: false,
//       activationPrice: undefined,
//       callbackRate: undefined,
//       realizedProfit: '0'
//     }
//   }

// // Configuration
const symbol = process.env.SYMBOL;
const stepSizePercent = process.env.STEP_SIZE_PERCENT;
const firstOrderStopLossPercent = process.env.FIRST_ORDER_STOP_LOSS_PERCENT;
const subsequentOrderStopLossPercent =
  process.env.SUBSEQUENT_ORDER_STOP_LOSS_PERCENT;
const maxOpenTrades = process.env.MAX_ORDER_TRADES;
const orderAmount = process.env.ORDER_AMOUNT;

const cutToSingleDecimal = (value) => value.toFixed(2);

// // Utility functions
const priceToPercent = (percent, price) => (price * percent) / 100;

// // Function to add a stop loss to an existing order
async function placeStopLossOrder(symbol, quantity, stopPrice) {
  try {
    const stopLossOrder = await binance.futuresSell(symbol, quantity, null, {
      stopPrice: stopPrice,
      type: "STOP_MARKET",
    });

    return stopLossOrder;
  } catch (error) {
    console.error("Error placing stop-loss order:", error.body);
  }
}

// // Function to fetch position
async function fetchPosition(symbol) {
  try {
    const positions = await binance.futuresPositionRisk();
    const position = positions.find(
      (pos) => pos.symbol === symbol && parseFloat(pos.positionAmt) !== 0
    );

    return position;
  } catch (error) {
    console.error("Error position:", error.body);
  }
}

function generateStopPriceOrders(
  startPrice,
  numberOfOrders,
  quantity,
  incrementPercentage,
  type
) {
  let orders = [];
  let currentPrice = startPrice;
  let incrementFactor =
    type === "buy"
      ? 1 + incrementPercentage / 100
      : 1 - incrementPercentage / 100;

  for (let i = 0; i < numberOfOrders; i++) {
    orders.push({
      stopPrice: currentPrice.toFixed(2),
      quantity: quantity,
      type: type, // 'buy' or 'sell'
    });
    currentPrice *= incrementFactor;
  }

  return orders;
}

async function placeFuturesStopOrders(
  startPrice,
  numberOfOrders,
  quantity,
  incrementPercentage,
  type,
  symbol
) {
  const orders = generateStopPriceOrders(
    startPrice,
    numberOfOrders,
    quantity,
    incrementPercentage,
    type
  );

  for (let order of orders) {
    try {
      // Differentiate between buy and sell using the appropriate function
      const orderFunction =
        order.type === "buy" ? binance.futuresBuy : binance.futuresSell;
      const response = await orderFunction(symbol, order.quantity, null, {
        type: "STOP_MARKET",
        stopPrice: order.stopPrice,
      });
    } catch (error) {
      console.error(
        `Failed to place ${order.type} futures stop-market order:`,
        error
      );
    }
  }
}

// Place a market buy order
await binance.futuresMarketBuy(symbol, orderAmount);

// Fetch position information
const position = await fetchPosition(symbol);

const orderPrice = +position.breakEvenPrice;
const stopLossPrice = cutToSingleDecimal(
  orderPrice - priceToPercent(firstOrderStopLossPercent, orderPrice)
);

placeStopLossOrder(symbol, position.positionAmt, stopLossPrice);

// Example usage:
const startPrice = orderPrice; // Starting price
const numberOfOrders = maxOpenTrades; // Number of orders to generate
const quantity = orderAmount; // Quantity for each order
const incrementPercentage = stepSizePercent; // Percentage increase or decrease
const type = "buy"; // Order type: 'buy' or 'sell'

placeFuturesStopOrders(
  startPrice,
  numberOfOrders,
  quantity,
  incrementPercentage,
  type,
  symbol
);

function orderUpdateCallback({ order }) {
  if (order.executionType === "TRADE" && order.orderStatus === "FILLED") {
    // console.log("Order Filled:", order);
  }
}

// Setup the futures data WebSocket
binance.websockets.userFutureData(null, null, orderUpdateCallback, null, null);
