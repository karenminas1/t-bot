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

let asyncInProgress = false;
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

const cutToSingleDecimal = (value) => value.toFixed(2);

// // Utility functions
const priceToPercent = (percent, price) => (price * percent) / 100;

function calculateNumberOfOrders(positionAmt, ORDER_AMOUNT) {
  return Math.ceil(positionAmt / ORDER_AMOUNT);
}

async function getOrdersAndPosition(symbol, orderAmount) {
  try {
    const [position, openOrders] = await Promise.all([
      fetchPosition(symbol),
      binance.futuresOpenOrders(symbol),
    ]);

    // Find the stop market sell order
    const stopMarketSellOrder = openOrders.find(
      (order) => order.origType === "STOP_MARKET" && order.side === "SELL"
    );

    // Calculate number of orders, last order price, and stop loss price
    if (position && stopMarketSellOrder) {
      const orderCount = calculateNumberOfOrders(
        position.positionAmt,
        orderAmount
      );
      const lastOrderPrice = position.entryPrice;
      const stopLossPrice = stopMarketSellOrder.stopPrice;

      return { orderCount, lastOrderPrice, stopLossPrice };
    } else {
      return { orderCount: 0, lastOrderPrice: null, stopLossPrice: null };
    }
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

async function handleStopLoss() {
  try {
    const position = await fetchPosition(symbol);

    if (position) {
      const sellPromise = binance.futuresMarketSell(
        symbol,
        position.positionAmt
      );
      const cancelPromise = binance.futuresCancelAll(symbol);

      // Execute both promises concurrently
      await Promise.all([sellPromise, cancelPromise]);
    }

    orderCount = 0;
    lastOrderPrice = null;
    stopLossPrice = null;
    console.log("stop loss triggered:", stopLossPrice);
  } catch (error) {
    console.error("Error processing stop loss:", error);
    throw error; // Re-throw the error to be handled by the caller
  } finally {
    asyncInProgress = false;
  }
}

async function openOrder(symbol, orderAmount, stopLossPercent) {
  // todo, check buy order result's entry price and set stop lose based on it looks like it is wrong to use position's breakEvenPrice it should be last order price's - 0.5  or 1%
  try {
    // Place a market buy order
    await binance.futuresMarketBuy(symbol, orderAmount);

    // Fetch position information
    const position = await fetchPosition(symbol);

    if (!position) {
      return {
        orderCount: 0,
        lastOrderPrice: null,
        stopLossPrice: null,
      };
    }

    // Calculate entry price and stop loss price
    const entryPrice = +position.breakEvenPrice;
    stopLossPrice = cutToSingleDecimal(
      entryPrice - priceToPercent(stopLossPercent, entryPrice)
    );

    // Place a stop loss order
    const { stopPrice } = await placeStopLossOrder(
      symbol,
      position.positionAmt,
      stopLossPrice
    );

    // Return order details
    return {
      orderCount: ++orderCount,
      entryPrice: entryPrice,
      stopPrice: stopPrice,
      lastOrderPrice: entryPrice,
      stopLossPrice: stopPrice,
    };
  } catch (error) {
    console.error("Error in openOrder:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

const handleOpenOrder = async (
  symbol,
  orderAmount,
  stopLossPercent,
  isFirst = true
) => {
  try {
    const res = await openOrder(symbol, orderAmount, stopLossPercent);
    orderCount = res.orderCount;
    lastOrderPrice = res.entryPrice;
    stopLossPrice = res.stopPrice;
    console.log(
      `open order ${isFirst ? "first" : "subsequent"}: ${
        res.entryPrice
      } stop loss: ${res.stopPrice}`
    );
  } catch (error) {
    console.error("Error in handleOpenOrder:", error);
    lastOrderPrice = null;
    stopLossPrice = null;
    orderCount = 0;
    throw error; // Re-throw the error to propagate it
  }
};

try {
  const res = await getOrdersAndPosition(symbol, orderAmount);

  lastOrderPrice = res.lastOrderPrice;
  stopLossPrice = res.stopLossPrice;
  orderCount = res.orderCount;
} catch (error) {
  lastOrderPrice = null;
  stopLossPrice = null;
  orderCount = 0;
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
      asyncInProgress = true;
      await handleStopLoss();
    } else if (!asyncInProgress && orderCount === 0) {
      asyncInProgress = true;
      await handleOpenOrder(symbol, orderAmount, firstOrderStopLossPercent);
      asyncInProgress = false;
    } else if (
      !asyncInProgress &&
      orderCount < maxOpenTrades &&
      lastOrderPrice &&
      tickerPrice >=
        lastOrderPrice + priceToPercent(stepSizePercent, lastOrderPrice)
    ) {
      asyncInProgress = true;
      await binance.futuresCancelAll(symbol);
      await handleOpenOrder(
        symbol,
        orderAmount,
        subsequentOrderStopLossPercent,
        false
      );
      asyncInProgress = false;
    }
  } catch (error) {
    console.error("Error in futuresMiniTickerStream:", error);
  }
});
