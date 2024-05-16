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

let asyncInProgress = false;
let stopLossPrice = null;
let orders = [];

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
  orders = generateStopPriceOrders(
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
      await orderFunction(symbol, order.quantity, null, {
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

async function openOrder(symbol, orderAmount, stopLossPercent, type = "buy") {
  try {
    // Place a market buy order
    const futuresMarketFunction =
      type === "buy" ? binance.futuresMarketBuy : binance.futuresMarketSell;
    await futuresMarketFunction(symbol, orderAmount);

    // Fetch position information
    const position = await fetchPosition(symbol);

    if (!position) return;

    // Calculate entry price and stop loss price
    const entryPrice = +position.breakEvenPrice;
    let slp =
      type === "buy"
        ? entryPrice - priceToPercent(stopLossPercent, entryPrice)
        : entryPrice + priceToPercent(stopLossPercent, entryPrice);
    const stopLossPrice = cutToSingleDecimal(slp);

    // Place a stop loss order
    await placeStopLossOrder(symbol, position.positionAmt, stopLossPrice);

    const startPrice =
      type === "buy"
        ? entryPrice + (stepSizePercent * entryPrice) / 100
        : entryPrice - (stepSizePercent * entryPrice) / 100;

    await placeFuturesStopOrders(
      startPrice,
      maxOpenTrades,
      orderAmount,
      stepSizePercent,
      type,
      symbol
    );

    return {
      stopLossPrice,
    };
  } catch (error) {
    console.error("Error in openOrder:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

const order = await openOrder(
  symbol,
  orderAmount,
  firstOrderStopLossPercent,
  "buy"
);

stopLossPrice = order.stopLossPrice;

// Subscribe to the futuresMiniTickerStream
binance.futuresMiniTickerStream(symbol, async ({ close: tickerPrice }) => {
  try {
    // for (let i = 0; i < orders.length; i++) {
    //   const order = orders[i];
    //   if (tickerPrice >= order.stopPrice) {
    //     try {
    //       const openOrders = await binance.futuresOpenOrders(symbol);
    //       const stopMarketSellOrder = openOrders.find(
    //         (openOrder) =>
    //           openOrder.origType === "STOP_MARKET" && openOrder.side === "SELL"
    //       );
    //       if (stopMarketSellOrder) {
    //         await cancelOrderById(symbol, stopMarketSellOrder.orderId);
    //       }
    //       await placeStopLossOrder(
    //         symbol,
    //         order.quantity * i,
    //         order.stopPrice -
    //           (subsequentOrderStopLossPercent * order.stopPrice) / 100
    //       );
    //       console.log(`Stop price: ${order.stopPrice}`);
    //       break; // Exit the loop after processing the first matching order
    //     } catch (error) {
    //       console.error(
    //         `Error processing order at stop price ${order.stopPrice}:`,
    //         error
    //       );
    //     }
    //   }
    // }
    // if (
    //   !asyncInProgress &&
    //   tickerPrice &&
    //   stopLossPrice &&
    //   tickerPrice <= stopLossPrice
    // ) {
    //   asyncInProgress = true;
    //   //   await handleStopLoss();
    //   //   const order = await openOrder(
    //   //     symbol,
    //   //     orderAmount,
    //   //     firstOrderStopLossPercent
    //   //   );
    //   //   stopLossPrice = order.stopLossPrice;
    //   asyncInProgress = false;
    // }
  } catch (error) {
    console.error("Error placing stop-loss order:", error.body);
  } finally {
    asyncInProgress = false;
  }
});
