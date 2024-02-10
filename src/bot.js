import "dotenv/config";
import Binance from "node-binance-api";

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;

const binance = new Binance().options({
  APIKEY: apiKey,
  APISECRET: apiSecret,
  test: true,
  family: 4,
});

// Configuration
const symbol = process.env.SYMBOL;
const stepSizePercent = process.env.STEP_SIZE_PERCENT;
const firstOrderStopLossPercent = process.env.FIRST_ORDER_STOP_LOSS_PERCENT;
const subsequentOrderStopLossPercent =
  process.env.SUBSEQUENT_ORDER_STOP_LOSS_PERCENT;
const maxOpenTrades = process.env.MAX_ORDER_TRADES;
const orderAmount = process.env.ORDER_AMOUNT;

let lastOrderPrice = null;
let orderCount = 0;

// Utility functions
const priceToPercent = (percent, price) => (price * percent) / 100;

// Function to place a new order
async function placeNewOrder(symbol, quantity) {
  try {
    const order = await binance.futuresMarketBuy(symbol, quantity);

    return order;
  } catch (error) {
    console.error("Error placing order:", error.body);
  }
}

// Function to add a stop loss to an existing order
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

// Function to cancel all futures orders for a position
async function cancelAllFuturesOrders(symbol) {
  try {
    const response = await binance.futuresCancelAll(symbol);
    console.log(
      "All futures orders for the symbol have been canceled:",
      response
    );
  } catch (error) {
    console.error("Error canceling all futures orders:", error.body);
  }
}

// Function to fetch position
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

function cutToSingleDecimal(value) {
  return Math.floor(value * 10) / 10;
}

binance.futuresMiniTickerStream(symbol, async ({ close: tickerPrice }) => {
  if (orderCount === 0) {
    console.log(`Game started`);
    await placeNewOrder(symbol, orderAmount);
  } else if (orderCount < maxOpenTrades) {
    if (
      lastOrderPrice &&
      tickerPrice >=
        lastOrderPrice + priceToPercent(stepSizePercent, lastOrderPrice)
    ) {
      await placeNewOrder(symbol, orderAmount);
    }
  }
});

// Define your callback functions
const marginCallCallback = (data) => {
  console.log("Margin Call Data:", "data");
};

const accountUpdateCallback = async (data) => {
  const positions = data.updateData.positions.filter(
    (position) =>
      position.symbol === symbol && parseFloat(position.positionAmount) !== 0
  );

  if (positions.length) {
    const position = positions[0];
    if (orderCount === 0) {
      const entryPrice = +position.entryPrice;

      const stopLossLevel =
        entryPrice - priceToPercent(firstOrderStopLossPercent, entryPrice);

      await placeStopLossOrder(
        symbol,
        position.positionAmount,
        cutToSingleDecimal(stopLossLevel)
      );

      lastOrderPrice = entryPrice;
      orderCount++;
      console.log(`open order: ${entryPrice} stop loss: ${stopLossLevel}`);
    } else {
      const entryPrice = +position.entryPrice;

      const stopLossLevel =
        entryPrice - priceToPercent(subsequentOrderStopLossPercent, entryPrice);
      await cancelAllFuturesOrders(symbol);
      await placeStopLossOrder(
        symbol,
        position.positionAmount,
        cutToSingleDecimal(stopLossLevel)
      );
      lastOrderPrice = entryPrice;
      orderCount++;
      console.log(`open order: ${entryPrice} stop loss: ${stopLossLevel}`);
    }
  }
};

const orderUpdateCallback = (data) => {
  console.log("Order Update Data:", "data");
};

const subscribedCallback = async (endpoint) => {
  const position = await fetchPosition(symbol);
  if (position) {
    orderCount = [position].length;
    lastOrderPrice = +position.entryPrice;
  } else {
    orderCount = 0;
    lastOrderPrice = null;
  }

  console.log(
    `Subscribed to futures user data stream at endpoint: ${endpoint}`
  );
};

// Subscribe to futures user data stream
binance.websockets.userFutureData(
  marginCallCallback,
  accountUpdateCallback,
  orderUpdateCallback,
  subscribedCallback
);
