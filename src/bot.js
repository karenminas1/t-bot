import http from "http";
import ccxt from "ccxt";

const exchange = new ccxt.binance();

const symbol = "BTC/USDT";
const timeframe = "5m";
const shortPeriod = 5;
const longPeriod = 20;
const volumePeriod = 7;
const requestPeriod = 3000;

// let holding = false;
let entryPrice = 0;
let unitsTraded = 0;
let totalPNL = 0;
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

function placeLongOrder(ep, ut) {
  entryPrice = ep;
  unitsTraded = ut;
  // TODO request for long order here
  console.log("Long order placed at " + entryPrice);
}

function placeShortOrder(ep, ut) {
  entryPrice = ep;
  unitsTraded = ut;
  // TODO request for short order here
  console.log("Short order placed at " + entryPrice);
}

function closeShortOrder(currentPrice) {
  totalPNL += -calculatePNL(currentPrice, entryPrice, unitsTraded) ?? 0;
  reset();
}

function closeLongOrder(currentPrice) {
  totalPNL += calculatePNL(currentPrice, entryPrice, unitsTraded) ?? 0;
  reset();
}

function reset() {
  entryPrice = 0;
  unitsTraded = 0;
}

async function executeSignal(signal) {
  if (signal === "buy" && !buyOrder) {
    const currentPrice = await getCurrentPrice(symbol);

    if (sellOrder) {
      closeShortOrder(currentPrice);
      console.log("Closing sell order..." + "PNL" + totalPNL);
      sellOrder = false;
    }

    placeLongOrder(currentPrice, 1);
    console.log("Executing buy signal...");

    buyOrder = true;
  } else if (signal === "sell" && !sellOrder) {
    const currentPrice = await getCurrentPrice(symbol);
    if (buyOrder) {
      closeLongOrder(currentPrice);
      console.log("Closing buy order..." + "PNL" + totalPNL);
      buyOrder = false;
    }

    placeShortOrder(currentPrice, 1);
    console.log("Executing sell signal...");

    sellOrder = true;
  }
}

const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.write(
    JSON.stringify({
      "Total PNL": totalPNL,
    })
  );
  response.end();
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  setInterval(async () => {
    const prices = await getHistoricalPrices(symbol, timeframe); // array of historical prices
    const volumeData = await getVolumeData(symbol, timeframe); // array of historical prices
    const signal = checkSignal(
      prices,
      shortPeriod,
      longPeriod,
      isVolumeHigh(volumeData, volumePeriod)
    );
    await executeSignal(signal);
  }, requestPeriod);
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
