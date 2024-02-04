import "dotenv/config";
import Binance from "node-binance-api";

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;

const binance = new Binance().options({
  APIKEY: apiKey,
  APISECRET: apiSecret,
  test: true,
});

// Configuration
// const symbol = "BTCUSDT";
// const stepSizePercent = 2;
// const firstOrderStopLossPercent = 1;
// const subsequentOrderStopLossPercent = 0.5;
// const maxOpenTrades = 10;
// const orderAmount = 0.004;
const symbol = process.env.SYMBOL;
const stepSizePercent = process.env.STEP_SIZE_PERCENT;
const firstOrderStopLossPercent = process.env.FIRST_ORDER_STOP_LOSS_PERCENT;
const subsequentOrderStopLossPercent =
  process.env.SUBSEQUENT_ORDER_STOP_LOSS_PERCENT;
const maxOpenTrades = process.env.MAX_ORDER_TRADES;
const orderAmount = process.env.ORDER_AMOUNT;

let lastOrderPrice = null;
let stopLossLevel = null;
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

// Function to fetch position
async function fetchPosition(symbol) {
  try {
    const account = await binance.futuresAccount();
    const position = account.positions.find((pos) => pos.symbol === symbol);

    return position;
  } catch (error) {
    console.error("Error position:", error.body);
  }
}

function cutToSingleDecimal(value) {
  return Math.floor(value * 10) / 10;
}

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

async function checkAndExecuteTrades() {
  try {
    const tickerPrices = await binance.futuresPrices();
    const tickerPrice = tickerPrices[symbol];

    const position = await fetchPosition(symbol);
    if (position.positionAmt !== "0.000") {
      orderCount++;
      lastOrderPrice = +position.entryPrice;
    } else {
      orderCount = 0;
      lastOrderPrice = null;
      lastOrderPrice = null;
    }

    if (orderCount === 0) {
      console.log(`Game started`);
      await placeNewOrder(symbol, orderAmount);
      const position = await fetchPosition(symbol);
      const entryPrice = +position.entryPrice;

      stopLossLevel =
        entryPrice - priceToPercent(firstOrderStopLossPercent, entryPrice);

      await placeStopLossOrder(
        symbol,
        position.positionAmt,
        cutToSingleDecimal(stopLossLevel)
      );

      lastOrderPrice = entryPrice;
      console.log(`open order: ${entryPrice} stop loss: ${stopLossLevel}`);
    } else if (orderCount < maxOpenTrades) {
      if (
        tickerPrice >=
        lastOrderPrice + priceToPercent(stepSizePercent, lastOrderPrice)
      ) {
        await placeNewOrder(symbol, orderAmount);
        const position = await fetchPosition(symbol);
        const entryPrice = +position.entryPrice;

        stopLossLevel =
          entryPrice -
          priceToPercent(subsequentOrderStopLossPercent, entryPrice);
        await cancelAllFuturesOrders(symbol);
        await placeStopLossOrder(
          symbol,
          position.positionAmt,
          cutToSingleDecimal(stopLossLevel)
        );
        lastOrderPrice = entryPrice;
        console.log(`open order: ${entryPrice} stop loss: ${stopLossLevel}`);
      }
    }
  } catch (error) {
    console.error(error);
  }
}

setInterval(async () => {
  try {
    await checkAndExecuteTrades();
  } catch (error) {
    console.error(error);
  }
}, 3000);
