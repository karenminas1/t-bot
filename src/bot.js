import http from "http";
import ejs from "ejs";
import ccxt from "ccxt";

const exchange = new ccxt.binance();

const symbol = "BTC/USDT";
const timeframe = "1m";
const shortPeriod = 5;
const longPeriod = 20;
const volumePeriod = 7;
const feePercent = 0.1;
const unitsTraded = 1;

const requestPeriod = 5000;
let entryPrice = 0;
let totalPNL = 0;
let totalTransaktionFee = 0;
let entryTime = null;
let buyOrder = false;
let sellOrder = false;

async function getHistoricalPrices(symbol, timeframe) {
  const ohlcv = await exchange.fetchOHLCV(symbol, timeframe);
  return ohlcv.map((candle) => candle[4]); // return close prices
}

async function getVolumeData(symbol, timeframe) {
  const candles = await exchange.fetchOHLCV(symbol, timeframe);
  return candles.map((candle) => candle[5]); // return volume
}

async function getCurrentPrice(symbol) {
  const ticker = await exchange.fetchTicker(symbol);

  return ticker.last;
}

function computeMA(prices, period) {
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[prices.length - period + i];
  }
  return sum / period;
}

function isVolumeHigh(volumeData, period) {
  // const averageVolume =
  //   volumeData.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const averageVolume = computeMA(volumeData, period);

  return volumeData[volumeData.length - 1] >= averageVolume * 1.5;
}

function checkSignal(prices, shortPeriod, longPeriod) {
  const shortMA = computeMA(prices, shortPeriod);
  const longMA = computeMA(prices, longPeriod);

  if (shortMA > longMA) {
    return "buy";
  } else if (shortMA < longMA) {
    return "sell";
  } else {
    return "hold";
  }
}

function calculatePNL(currentPrice, entryPrice, unitsTraded) {
  return (currentPrice - entryPrice) * unitsTraded;
}

function placeLongOrder(ep) {
  entryPrice = ep;
  entryTime = getFormatedCurrentDate();
  // TODO request for long order here
}

function placeShortOrder(ep) {
  entryPrice = ep;
  entryTime = getFormatedCurrentDate();
  // TODO request for short order here
}

function closeShortOrder(currentPrice) {
  totalPNL += -calculatePNL(currentPrice, entryPrice, unitsTraded) ?? 0;
}

function closeLongOrder(currentPrice) {
  totalPNL += calculatePNL(currentPrice, entryPrice, unitsTraded) ?? 0;
}

function reset() {
  entryPrice = 0;
  entryTime = null;
}

function getFormatedCurrentDate() {
  var d = new Date();
  return (
    [d.getMonth() + 1, d.getDate(), d.getFullYear()].join("/") +
    " " +
    [d.getHours(), d.getMinutes(), d.getSeconds()].join(":")
  );
}

function calculateTradingFee(unitsTraded, price, feePercent) {
  return unitsTraded * price * (feePercent / 100);
}

function accTradingFee(unitsTraded, price, feePercent) {
  totalTransaktionFee += calculateTradingFee(unitsTraded, price, feePercent);
}

function log(type, entryPrice, currentPrice, entryTime, unitsTraded, totalPNL) {
  const pnl = calculatePNL(currentPrice, entryPrice, unitsTraded);
  console.log(
    `${type} | Entry Price: ${entryPrice} | Exit Price: ${currentPrice} | PNL  ${
      type === "SHORT" ? -pnl : pnl
    } | Entry Time: ${entryTime} | Exit Time: ${getFormatedCurrentDate()} | Total PNL: ${totalPNL}`
  );
}

async function executeSignal(signal) {
  if (signal === "buy" && !buyOrder) {
    const currentPrice = await getCurrentPrice(symbol);

    if (sellOrder) {
      closeShortOrder(currentPrice);
      accTradingFee(unitsTraded, currentPrice, feePercent);
      log("SHORT", entryPrice, currentPrice, entryTime, unitsTraded, totalPNL);
      reset();

      sellOrder = false;
    }

    placeLongOrder(currentPrice);
    accTradingFee(unitsTraded, currentPrice, feePercent);

    buyOrder = true;
  } else if (signal === "sell" && !sellOrder) {
    const currentPrice = await getCurrentPrice(symbol);
    if (buyOrder) {
      closeLongOrder(currentPrice);
      accTradingFee(unitsTraded, currentPrice, feePercent);
      log("BUY", entryPrice, currentPrice, entryTime, unitsTraded, totalPNL);
      reset();

      buyOrder = false;
    }

    placeShortOrder(currentPrice);
    accTradingFee(unitsTraded, currentPrice, feePercent);

    sellOrder = true;
  }
}

setInterval(async () => {
  const prices = await getHistoricalPrices(symbol, timeframe); // array of historical prices
  // const volumeData = await getVolumeData(symbol, timeframe); // array of historical prices
  const signal = checkSignal(
    prices,
    shortPeriod,
    longPeriod
    // isVolumeHigh(volumeData, volumePeriod)
  );
  await executeSignal(signal);
}, requestPeriod);

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    ejs.renderFile(
      "./src/index.ejs",
      {
        data: {
          totalPNL,
          totalTransaktionFee,
        },
      },
      (err, str) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("500 error: couldn't render file.");
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(str);
        }
      }
    );
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 error: endpoint not found.");
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening on port - ${port}`);
});

// function x(currentPrice) {
//   let pnl;

//   // if (unitsTraded > 0) {
//   // TODO request sell order here
//   pnl = calculatePNL(currentPrice, entryPrice, unitsTraded);
//   console.log("Sell order placed at " + currentPrice + " with PNL of " + pnl);
//   entryPrice = 0;
//   unitsTraded = 0;
//   // } else {
//   // console.log("No units to sell");
//   // }

//   return pnl ?? 0;
// }

// function placeBuyOrder(ep, ut) {
//   entryPrice = ep;
//   unitsTraded = ut;
//   // TODO request buy order here
//   console.log("Buy order placed at " + entryPrice);
// }

// function placeSellOrder(currentPrice) {
//   let pnl;

//   // if (unitsTraded > 0) {
//   // TODO request sell order here
//   pnl = calculatePNL(currentPrice, entryPrice, unitsTraded);
//   console.log("Sell order placed at " + currentPrice + " with PNL of " + pnl);
//   entryPrice = 0;
//   unitsTraded = 0;
//   // } else {
//   // console.log("No units to sell");
//   // }

//   return pnl ?? 0;
// }

// async function executeSignal(signal) {
//   if (signal === "buy" && !holding) {
//     const currentPrice = await getCurrentPrice(symbol);
//     placeBuyOrder(currentPrice, 1);
//     console.log("Executing buy signal...");
//     holding = true;
//   } else if (signal === "sell" && holding) {
//     const currentPrice = await getCurrentPrice(symbol);
//     totalPNL += placeSellOrder(currentPrice);
//     console.log("Executing sell signal...");
//     console.log("totalPNL..." + totalPNL);
//     holding = false;
//   } else {
//     // console.log("Holding position...");
//   }
// }
