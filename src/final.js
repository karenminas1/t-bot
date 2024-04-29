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
let stopLossPrice = null;
let orderCount = 0;

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

function cutToSingleDecimal(value) {
  return Math.floor(value * 10) / 10;
}

// // Utility functions
const priceToPercent = (percent, price) => (price * percent) / 100;

function calculateNumberOfOrders(positionAmt, ORDER_AMOUNT) {
  return Math.ceil(positionAmt / ORDER_AMOUNT);
}

let asyncInProgress = false;

async function handleStopLoss() {
  try {
    asyncInProgress = true;
    const position = await fetchPosition(symbol);

    if (!position) {
      orderCount = 0;
      lastOrderPrice = null;
      stopLossPrice = null;
      console.log("stop loss triggered:", stopLossPrice);
    }
  } catch (error) {
    console.error("Error processing stop loss:", error);
  } finally {
    asyncInProgress = false;
  }
}

async function initialOrder() {
  try {
    asyncInProgress = true;
    await binance.futuresMarketBuy(symbol, orderAmount);
    const position = await fetchPosition(symbol);

    const entryPrice = +position.entryPrice;
    lastOrderPrice = entryPrice;
    orderCount++;

    stopLossPrice = cutToSingleDecimal(
      entryPrice - priceToPercent(firstOrderStopLossPercent, entryPrice)
    );

    await placeStopLossOrder(symbol, position.positionAmt, stopLossPrice);

    console.log(
      "orderCount === 0:",
      `open order: ${entryPrice} stop loss: ${stopLossPrice}`
    );
  } catch (error) {
    console.error("Error placing initial order:", error);
  } finally {
    asyncInProgress = false;
  }
}

async function subsequentOrder() {
  try {
    asyncInProgress = true;
    await binance.futuresMarketBuy(symbol, orderAmount);
    const position = await fetchPosition(symbol);

    const entryPrice = +position.entryPrice;
    lastOrderPrice = entryPrice;
    orderCount++;

    stopLossPrice = cutToSingleDecimal(
      entryPrice - priceToPercent(subsequentOrderStopLossPercent, entryPrice)
    );

    await binance.futuresCancelAll(symbol);
    await placeStopLossOrder(symbol, position.positionAmt, stopLossPrice);

    console.log(
      "orderCount > 0:",
      `open order: ${entryPrice} stop loss: ${stopLossPrice}`
    );
  } catch (error) {
    console.error("Error placing second order:", error);
  } finally {
    asyncInProgress = false;
  }
}

// Subscribe to the futuresMiniTickerStream
binance.futuresMiniTickerStream(symbol, async ({ close: tickerPrice }) => {
  try {
    if (
      !asyncInProgress &&
      tickerPrice &&
      stopLossPrice &&
      tickerPrice <= stopLossPrice
    ) {
      await handleStopLoss();
    }

    if (!asyncInProgress && orderCount === 0) {
      await initialOrder();
    } else if (!asyncInProgress && orderCount < maxOpenTrades) {
      if (
        lastOrderPrice &&
        tickerPrice >=
          lastOrderPrice + priceToPercent(stepSizePercent, lastOrderPrice)
      ) {
        await subsequentOrder();
      }
    }
  } catch (error) {
    console.error("Error in futuresMiniTickerStream:", error);
  }
});
