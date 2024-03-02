import "dotenv/config";
import BinanceAPI from "./binanceAPI.js";

import Binance from "node-binance-api";

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;

// const binance = new Binance().options({
//   APIKEY: apiKey,
//   APISECRET: apiSecret,
//   // test: true,
//   reconnect: true,
//   family: 6,
// });

// // Configuration
const symbol = process.env.SYMBOL;
const stepSizePercent = process.env.STEP_SIZE_PERCENT;
const firstOrderStopLossPercent = process.env.FIRST_ORDER_STOP_LOSS_PERCENT;
const subsequentOrderStopLossPercent =
  process.env.SUBSEQUENT_ORDER_STOP_LOSS_PERCENT;
const maxOpenTrades = process.env.MAX_ORDER_TRADES;
const orderAmount = process.env.ORDER_AMOUNT;

// let lastOrderPrice = null;
// let orderCount = 0;
// let isSubscribed = false;

// // Utility functions
// const priceToPercent = (percent, price) => (price * percent) / 100;

// // Function to place a new order
// async function placeNewOrder(symbol, quantity) {
//   try {
//     const order = await binance.futuresMarketBuy(symbol, quantity);

//     return order;
//   } catch (error) {
//     console.error("Error placing order:", error.body);
//   }
// }

// // Function to add a stop loss to an existing order
// async function placeStopLossOrder(symbol, quantity, stopPrice) {
//   try {
//     const stopLossOrder = await binance.futuresSell(symbol, quantity, null, {
//       stopPrice: stopPrice,
//       type: "STOP_MARKET",
//     });

//     return stopLossOrder;
//   } catch (error) {
//     console.error("Error placing stop-loss order:", error.body);
//   }
// }

// // Function to cancel all futures orders for a position
// async function cancelAllFuturesOrders(symbol) {
//   try {
//     const response = await binance.futuresCancelAll(symbol);

//     return response;
//   } catch (error) {
//     console.error("Error canceling all futures orders:", error.body);
//   }
// }

// // Function to fetch position
// async function fetchPosition(symbol) {
//   try {
//     const positions = await binance.futuresPositionRisk();
//     const position = positions.find(
//       (pos) => pos.symbol === symbol && parseFloat(pos.positionAmt) !== 0
//     );

//     return position;
//   } catch (error) {
//     console.error("Error position:", error.body);
//   }
// }

// function cutToSingleDecimal(value) {
//   return Math.floor(value * 10) / 10;
// }

// // Define your callback functions
// const marginCallCallback = (data) => {
//   console.log("Margin Call Data:", "data");
// };

// const orderUpdateCallback = (data) => {
//   // console.log("Order Update Data:", "data");
// };

// const accountUpdateCallback = async (data) => {
//   const positions = data.updateData.positions.filter(
//     (position) =>
//       position.symbol === symbol && parseFloat(position.positionAmount) !== 0
//   );

//   if (positions.length) {
//     console.log("🚀 ~ accountUpdateCallback ~ positions true:", positions);
//     const position = positions[0];
//     try {
//       if (orderCount === 0) {
//         console.log("🚀 ~ if orderCount", orderCount);
//         const entryPrice = +position.entryPrice;
//         lastOrderPrice = entryPrice;
//         orderCount++;

//         const stopLossLevel =
//           entryPrice - priceToPercent(firstOrderStopLossPercent, entryPrice);

//         await placeStopLossOrder(
//           symbol,
//           position.positionAmount,
//           cutToSingleDecimal(stopLossLevel)
//         );

//         console.log(`open order: ${entryPrice} stop loss: ${stopLossLevel}`);
//       } else {
//         console.log("🚀 ~ else orderCount", orderCount);
//         const entryPrice = +position.entryPrice;
//         lastOrderPrice = entryPrice;
//         orderCount++;

//         const stopLossLevel =
//           entryPrice -
//           priceToPercent(subsequentOrderStopLossPercent, entryPrice);

//         await cancelAllFuturesOrders(symbol);
//         await placeStopLossOrder(
//           symbol,
//           position.positionAmount,
//           cutToSingleDecimal(stopLossLevel)
//         );

//         console.log(`open order: ${entryPrice} stop loss: ${stopLossLevel}`);
//       }
//     } catch (error) {
//       console.error("Error in accountUpdateCallback:", error);
//       // Handle the error as needed
//     }
//   } else {
//     console.log("🚀 ~ accountUpdateCallback ~ positions false:", positions);
//     orderCount = 0;
//     lastOrderPrice = null;
//     console.log("🚀 ~ orderCount", orderCount);
//   }
// };

// const subscribedCallback = async (endpoint) => {
//   try {
//     const position = await fetchPosition(symbol);
//     if (position) {
//       console.log("🚀 ~ subscribedCallback ~ position true:", position);
//       orderCount = [position].length;
//       lastOrderPrice = +position.entryPrice;
//     } else {
//       console.log("🚀 ~ subscribedCallback ~ position false:", position);
//       orderCount = 0;
//       lastOrderPrice = null;
//     }
//   } catch (error) {
//     console.error("Error fetching position:", error);
//     // Handle the error as needed
//   }

//   isSubscribed = true;
//   console.log(
//     `Subscribed to futures user data stream at endpoint: ${endpoint}`
//   );
// };

// // Subscribe to futures user data stream
// binance.websockets.userFutureData(
//   marginCallCallback,
//   accountUpdateCallback,
//   orderUpdateCallback,
//   subscribedCallback
// );

// binance.futuresMiniTickerStream(symbol, async ({ close: tickerPrice }) => {
//   if (isSubscribed) {
//     try {
//       if (orderCount === 0) {
//         console.log("first order");
//         await placeNewOrder(symbol, orderAmount);
//       } else if (orderCount < maxOpenTrades) {
//         if (
//           lastOrderPrice &&
//           tickerPrice >=
//             lastOrderPrice + priceToPercent(stepSizePercent, lastOrderPrice)
//         ) {
//           console.log(
//             "rest orders",
//             "lastOrderPrice:",
//             lastOrderPrice,
//             "tickerPrice:",
//             tickerPrice
//           );
//           await placeNewOrder(symbol, orderAmount);
//         }
//       }
//     } catch (error) {
//       console.error("Error placing new order:", error);
//       // Handle the error as needed
//     }
//   }
// });

const binance = new BinanceAPI({
  APIKEY: apiKey,
  APISECRET: apiSecret,
  reconnect: true,
});

let x = 0;
binance.subscribeToFuturesMiniTicker(symbol, (data) => {
  if (data.error) {
    console.error(data.error);
  } else {
    const { c: closePrice } = data;

    if (x === 0) {
      console.log(`Close price: ${closePrice}`);
      x++;
    }
  }
});

// Example usage of the subscribeToUserFutureData public function
binance.subscribeToUserFutureData(
  (marginCallData) => {
    console.log("Margin Call:", "marginCallData");
  },
  (accountUpdateData) => {
    console.log("Account Update:", accountUpdateData);
  },
  (orderUpdateData) => {
    console.log("Order Update:", "orderUpdateData");
  },
  () => {
    console.log("Subscribed to futures user data stream.");
  }
);
