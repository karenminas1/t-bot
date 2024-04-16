import "dotenv/config";
import Binance from "node-binance-api";

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;

const binance = new Binance().options({
  APIKEY: apiKey,
  APISECRET: apiSecret,
  test: true,
  reconnect: true,
  family: 6,
});

// // Configuration
const symbol = process.env.SYMBOL;
const stepSizePercent = process.env.STEP_SIZE_PERCENT;
const firstOrderStopLossPercent = process.env.FIRST_ORDER_STOP_LOSS_PERCENT;
const subsequentOrderStopLossPercent =
  process.env.SUBSEQUENT_ORDER_STOP_LOSS_PERCENT;
const maxOpenTrades = process.env.MAX_ORDER_TRADES;
const orderAmount = process.env.ORDER_AMOUNT;

let lastOrderPrice = null;
let orderCount = 0;
let isSubscribed = false;

// // Utility functions
const priceToPercent = (percent, price) => (price * percent) / 100;

// // Function to place a new order
async function placeNewOrder(symbol, quantity) {
  try {
    const order = await binance.futuresMarketBuy(symbol, quantity);

    return order;
  } catch (error) {
    console.error("Error placing order:", error.body);
  }
}

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

// Function to cancel all futures orders for a position
async function cancelAllFuturesOrders(symbol) {
  try {
    const response = await binance.futuresCancelAll(symbol);

    return response;
  } catch (error) {
    console.error("Error canceling all futures orders:", error.body);
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

function cutToSingleDecimal(value) {
  return Math.floor(value * 10) / 10;
}

function calculateNumberOfOrders(positionAmt, ORDER_AMOUNT) {
  return Math.ceil(positionAmt / ORDER_AMOUNT);
}

binance.futuresMiniTickerStream(symbol, async ({ close: tickerPrice }) => {
  // if (orderCount === null) {
  //   const position = await fetchPosition(symbol);
  //   if (position) {
  //     lastOrderPrice = +position.entryPrice;
  //     orderCount = calculateNumberOfOrders(position.positionAmt, orderAmount);
  //     console.log("🚀 ~ orderCount === null:", orderCount);
  //   } else {
  //     orderCount = 0;
  //     lastOrderPrice = null;
  //   }
  // }

  try {
    if (orderCount === 0) {
      await binance.futuresMarketBuy(symbol, orderAmount);
      const position = await fetchPosition(symbol);

      const entryPrice = +position.entryPrice;
      lastOrderPrice = entryPrice;
      orderCount++;

      const stopLossLevel =
        entryPrice - priceToPercent(firstOrderStopLossPercent, entryPrice);

      await placeStopLossOrder(
        symbol,
        position.positionAmt,
        cutToSingleDecimal(stopLossLevel)
      );

      console.log(
        "orderCount === 0:",
        `open order: ${entryPrice} stop loss: ${stopLossLevel}`
      );
    } else if (orderCount < maxOpenTrades) {
      if (
        lastOrderPrice &&
        tickerPrice >=
          lastOrderPrice + priceToPercent(stepSizePercent, lastOrderPrice)
      ) {
        await binance.futuresMarketBuy(symbol, orderAmount);
        const position = await fetchPosition(symbol);

        const entryPrice = +position.entryPrice;
        lastOrderPrice = entryPrice;
        orderCount++;

        const stopLossLevel =
          entryPrice -
          priceToPercent(subsequentOrderStopLossPercent, entryPrice);

        await cancelAllFuturesOrders(symbol);
        await placeStopLossOrder(
          symbol,
          position.positionAmt,
          cutToSingleDecimal(stopLossLevel)
        );

        console.log(
          "orderCount > 0:",
          `open order: ${entryPrice} stop loss: ${stopLossLevel}`
        );
      }
    }
  } catch (error) {
    console.error("Err˜or placing new order:", error);
  }
});
