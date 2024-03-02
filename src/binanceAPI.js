import axios from "axios";
import WebSocket from "ws";

class BinanceAPI {
  #apiKey;
  #apiSecret;
  #urls;
  #reconnect;
  #reconnectDelay;
  #maxReconnectAttempts;
  #listenKey;
  #maxListenKeyRetries;
  #listenKeyRetryInterval;
  #environment;

  // Define default options
  static defaultOptions = {
    recvWindow: 5000,
    hedgeMode: false,
  };

  static defaultUrls = {
    production: {
      base: "https://api.binance.com/api/",
      wapi: "https://api.binance.com/wapi/",
      sapi: "https://api.binance.com/sapi/",
      futures: {
        base: "https://fapi.binance.com",
        fapi: "https://fapi.binance.com/fapi/",
        listenKey: "/fapi/v1/listenKey",
        wsBase: "wss://fstream.binance.com/ws/",
        fstream: "wss://fstream.binance.com/stream?streams=",
      },
      spot: {
        base: "https://api.binance.com",
        listenKey: "/api/v3/userDataStream",
        wsBase: "wss://stream.binance.com:9443/ws/",
      },
      fstream: "wss://fstream.binance.com/stream?streams=",
      fstreamSingle: "wss://fstream.binance.com/ws/",
      fstreamSingleTest: "wss://stream.binancefuture.com/ws/",
      fstreamTest: "wss://stream.binancefuture.com/stream?streams=",
      dstream: "wss://dstream.binance.com/stream?streams=",
      dstreamSingle: "wss://dstream.binance.com/ws/",
      dstreamSingleTest: "wss://dstream.binancefuture.com/ws/",
      dstreamTest: "wss://dstream.binancefuture.com/stream?streams=",
      stream: "wss://stream.binance.com:9443/ws/",
      combineStream: "wss://stream.binance.com:9443/stream?streams=",
    },
    testnet: {
      base: "https://testnet.binancefuture.com/fapi/",
      wapi: "https://testnet.binancefuture.com/wapi/",
      sapi: "https://testnet.binancefuture.com/sapi/",
      futures: {
        base: "https://testnet.binancefuture.com/fapi/",
        listenKey: "/fapi/v1/listenKey",
        wsBase: "wss://stream.binancefuture.com/ws/",
      },
      spot: {
        base: "https://testnet.binancefuture.com/dapi/",
        listenKey: "/dapi/v1/listenKey",
        wsBase: "wss://dstream.binancefuture.com/ws/",
      },
      fstream: "wss://fstream.binance.com/stream?streams=",
      fstreamSingle: "wss://fstream.binance.com/ws/",
      fstreamSingleTest: "wss://stream.binancefuture.com/ws/",
      fstreamTest: "wss://stream.binancefuture.com/stream?streams=",
      dstream: "wss://dstream.binance.com/stream?streams=",
      dstreamSingle: "wss://dstream.binance.com/ws/",
      dstreamSingleTest: "wss://dstream.binancefuture.com/ws/",
      dstreamTest: "wss://dstream.binancefuture.com/stream?streams=",
      stream: "wss://stream.binance.com:9443/ws/",
      combineStream: "wss://stream.binance.com:9443/stream?streams=",
    },
  };
  constructor(config) {
    this.#apiKey = config.APIKEY;
    this.#apiSecret = config.APISECRET;

    this.#environment = config.environment || "production"; // Default to production, can be testnet or sandbox
    this.#urls = {
      ...BinanceAPI.defaultUrls[this.#environment],
      ...(config[this.#environment]?.urls || {}),
    };
    this.#reconnect = config.reconnect || false;
    this.#reconnectDelay = config.reconnectDelay || 0;
    this.#maxReconnectAttempts = config.maxReconnectAttempts || 5;
    this.#listenKey = null;
    this.#maxListenKeyRetries = config.maxListenKeyRetries || 5;
    this.#listenKeyRetryInterval = config.listenKeyRetryInterval || 0;
  }

  async subscribeToUserFutureData(
    marginCallCallback,
    accountUpdateCallback,
    orderUpdateCallback
  ) {
    try {
      // Generate a listen key for the futures user data stream
      this.#listenKey = await this.#generateListenKey("futures");
      if (!this.#listenKey) {
        throw new Error(
          "Failed to generate listen key for futures user data stream."
        );
      }

      const wsUrl = `${this.#urls.futures.wsBase}${this.#listenKey}`;

      let ws;
      let reconnectAttempts = 0;
      let pingInterval;

      const connect = () => {
        console.log("Connecting to WebSocket...");
        ws = new WebSocket(wsUrl);

        ws.on("open", () => {
          console.log(
            `Subscribed to futures user data stream with listenKey: ${
              this.#listenKey
            }`
          );
          reconnectAttempts = 0;

          pingInterval = this.#setupPingPong(ws);
          pingInterval.startPing();
        });

        ws.on("message", (data) => {
          const message = JSON.parse(data);
          switch (message.e) {
            case "MARGIN_CALL":
              marginCallCallback(message);
              break;
            case "ACCOUNT_UPDATE":
              accountUpdateCallback(message);
              break;
            case "ORDER_TRADE_UPDATE":
              orderUpdateCallback(message);
              break;
            default:
              console.log("Unhandled event type:", message.e);
          }
        });

        ws.on("error", (error) => {
          console.error(`WebSocket error: ${error.message}`);
        });

        ws.on("close", () => {
          if (pingInterval && pingInterval.stopPing) {
            pingInterval.stopPing();
          }

          if (
            this.#reconnect &&
            reconnectAttempts < this.#maxReconnectAttempts
          ) {
            console.log(
              `WebSocket closed. Reconnecting in ${
                this.#reconnectDelay / 1000
              } seconds...`
            );
            setTimeout(connect, this.#reconnectDelay);
            reconnectAttempts++;
          } else {
            console.log("WebSocket closed without reconnection.");
          }
        });
      };

      if (this.#reconnect) {
        connect();
      }

      return {
        close: () => {
          if (ws) {
            ws.close();
          }
        },
      };
    } catch (error) {
      throw error;
    }
  }

  subscribeToFuturesMiniTicker(symbol, callback) {
    const streamName = `${symbol.toLowerCase()}@miniTicker`;
    const wsUrl = `${this.#urls.futures.fstream}${streamName}`;

    let ws;
    let reconnectAttempts = 0;

    const connect = () => {
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        console.log(`Subscribed to futures mini ticker stream for ${symbol}`);
        reconnectAttempts = 0;
      });

      ws.on("message", (data) => {
        const message = JSON.parse(data);
        const tickerData = message.data;
        if (tickerData && tickerData.e === "24hrMiniTicker") {
          callback(tickerData);
        }
      });

      ws.on("error", (error) => {
        console.error(`WebSocket error: ${error.message}`);
      });

      ws.on("close", () => {
        if (this.#reconnect && reconnectAttempts < this.#maxReconnectAttempts) {
          console.log(
            `WebSocket closed. Reconnecting in ${
              this.#reconnectDelay / 1000
            } seconds...`
          );
          setTimeout(connect, this.#reconnectDelay);
          reconnectAttempts++;
        } else if (this.#reconnect) {
          console.error(
            `Failed to reconnect after ${this.#maxReconnectAttempts} attempts.`
          );
          callback({
            error: `Failed to reconnect after ${
              this.#maxReconnectAttempts
            } attempts.`,
          });
        } else {
          console.log("WebSocket closed without reconnection.");
        }
      });
    };

    if (this.#reconnect) {
      connect();
    }

    return {
      close: () => {
        if (ws) {
          ws.close();
        }
      },
    };
  }

  async #generateListenKey(type, retries = 0) {
    try {
      // Generate a new listen key by making a POST request to the Binance API
      const response = await axios.post(
        `${this.#urls[type].base}${this.#urls[type].listenKey}`,
        {},
        {
          headers: { "X-MBX-APIKEY": this.#apiKey },
        }
      );
      const listenKey = response.data.listenKey;
      console.log(`${type.toUpperCase()} listen key generated:`, listenKey);
      // Renew the listen key periodically
      this.#renewListenKey(type, listenKey);
      return listenKey;
    } catch (error) {
      console.error(
        `Error generating ${type} listen key:`,
        error.response?.data || error.message
      );
      if (retries < this.#maxListenKeyRetries) {
        console.log(
          `Retrying ${type} listen key generation (${retries + 1}/${
            this.#maxListenKeyRetries
          })...`
        );
        await this.#delay(this.#listenKeyRetryInterval);
        return this.#generateListenKey(type, retries + 1);
      } else {
        throw new Error(
          `Max retries for ${type} listen key generation exceeded.`
        );
      }
    }
  }

  #renewListenKey(type, listenKey, retries = 0) {
    const renewInterval = setInterval(async () => {
      try {
        // Renew the listen key by making a PUT request to the Binance API
        await axios.put(
          `${this.#urls[type].base}${this.#urls[type].listenKey}`,
          {},
          {
            headers: { "X-MBX-APIKEY": this.#apiKey },
          }
        );
        console.log(`${type.toUpperCase()} listen key renewed:`, listenKey);
        retries = 0; // Reset retries on successful renewal
      } catch (error) {
        console.error(
          `Error renewing ${type} listen key:`,
          error.response?.data || error.message
        );
        console.log(
          "🚀 error.response?.data?.code",
          error.response?.data?.code,
          typeof error.response?.data?.code
        );
        if (
          error.response?.data?.code === "-1125" ||
          retries >= this.#maxListenKeyRetries
        ) {
          // Listen key does not exist or max retries exceeded, generate a new listen key
          console.log("Regenerating listen key...");
          this.#listenKey = await this.#generateListenKey(type);
          if (!this.#listenKey) {
            clearInterval(renewInterval);
            throw new Error("Failed to regenerate listen key.");
          }
          retries = 0; // Reset retries after successful regeneration
        } else {
          console.log(
            `Retrying ${type} listen key renewal (${retries + 1}/${
              this.#maxListenKeyRetries
            })...`
          );
          retries++;
        }
      }
    }, 15 * 60 * 1000); // Renew every 15 minutes
  }

  #delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  #setupPingPong(ws, intervalMinutes = 3) {
    let pingInterval;

    const startPing = () => {
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log("Sending ping...");
          ws.ping();
        }
      }, intervalMinutes * 60 * 1000); // Convert minutes to milliseconds
    };

    const stopPing = () => {
      clearInterval(pingInterval);
    };

    ws.on("pong", () => {
      console.log("Received pong");
    });

    return { startPing, stopPing };
  }

  async #futuresOrder(side, symbol, quantity, params = {}) {
    const endpoint = "v1/order";
    const data = {
      symbol: symbol.toUpperCase(),
      side: side.toUpperCase(),
      quantity: quantity,
      timestamp: Date.now(),
      ...params,
    };

    // Set order type
    if (!data.type) {
      data.type = params.price ? "LIMIT" : "MARKET";
    }

    // Set time in force for limit orders
    if (!data.timeInForce && data.type === "LIMIT") {
      data.timeInForce = "GTC"; // Good Till Cancelled
    }

    // Set position side for hedge mode
    if (options.hedgeMode && !data.positionSide) {
      data.positionSide = side === "BUY" ? "LONG" : "SHORT";
    }

    const signature = this.#sign(data);
    const response = await axios.post(
      `${this.#urls.futures.fapi}${endpoint}`,
      null,
      {
        headers: {
          "X-MBX-APIKEY": this.#apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        params: {
          ...data,
          signature: signature,
        },
      }
    );

    return response.data;
  }

  async futuresMarketBuy(symbol, quantity, params = {}) {
    return this.#futuresOrder("BUY", symbol, quantity, {
      ...params,
      type: "MARKET",
    });
  }

  async futuresMarketSell(symbol, quantity, params = {}) {
    return this.#futuresOrder("SELL", symbol, quantity, {
      ...params,
      type: "MARKET",
    });
  }

  async futuresLimitBuy(symbol, quantity, price, params = {}) {
    return this.#futuresOrder("BUY", symbol, quantity, {
      ...params,
      type: "LIMIT",
      price: price,
    });
  }

  async futuresLimitSell(symbol, quantity, price, params = {}) {
    return this.#futuresOrder("SELL", symbol, quantity, {
      ...params,
      type: "LIMIT",
      price: price,
    });
  }

  async futuresStopLossSell(symbol, quantity, stopPrice, params = {}) {
    return this.futuresOrder("SELL", symbol, quantity, {
      ...params,
      type: "STOP_MARKET",
      stopPrice: stopPrice,
    });
  }

  async futuresStopLossBuy(symbol, quantity, stopPrice, params = {}) {
    return this.futuresOrder("BUY", symbol, quantity, {
      ...params,
      type: "STOP_MARKET",
      stopPrice: stopPrice,
    });
  }

  async futuresTakeProfitSell(symbol, quantity, price, params = {}) {
    return this.futuresOrder("SELL", symbol, quantity, {
      ...params,
      type: "TAKE_PROFIT_MARKET",
      stopPrice: price,
    });
  }

  async futuresTakeProfitBuy(symbol, quantity, price, params = {}) {
    return this.futuresOrder("BUY", symbol, quantity, {
      ...params,
      type: "TAKE_PROFIT_MARKET",
      stopPrice: price,
    });
  }

  async futuresCancel(symbol, orderId) {
    const endpoint = "v1/order";
    const data = {
      symbol: symbol.toUpperCase(),
      orderId: orderId,
      timestamp: Date.now(),
    };

    const signature = this.#sign(data);
    const response = await axios.delete(
      `${this.#urls.futures.fapi}${endpoint}`,
      {
        headers: {
          "X-MBX-APIKEY": this.#apiKey,
        },
        params: {
          ...data,
          signature: signature,
        },
      }
    );

    return response.data;
  }

  async futuresCancelAll(symbol) {
    const endpoint = "v1/allOpenOrders";
    const data = {
      symbol: symbol.toUpperCase(),
      timestamp: Date.now(),
    };

    const signature = this.#sign(data);
    const response = await axios.delete(
      `${this.#urls.futures.fapi}${endpoint}`,
      {
        headers: {
          "X-MBX-APIKEY": this.#apiKey,
        },
        params: {
          ...data,
          signature: signature,
        },
      }
    );

    return response.data;
  }

  async futuresPositionRisk(symbol = null) {
    const endpoint = "v2/positionRisk";
    const data = {
      timestamp: Date.now(),
    };

    if (symbol) {
      data.symbol = symbol.toUpperCase();
    }

    const signature = this.#sign(data);
    const response = await axios.get(`${this.#urls.futures.fapi}${endpoint}`, {
      headers: {
        "X-MBX-APIKEY": this.#apiKey,
      },
      params: {
        ...data,
        signature: signature,
      },
    });

    return response.data;
  }

  #sign(data) {
    const queryString = Object.keys(data)
      .map((key) => `${key}=${data[key]}`)
      .join("&");
    return crypto
      .createHmac("sha256", this.#apiSecret)
      .update(queryString)
      .digest("hex");
  }

  async #promiseRequest(endpoint, data = {}, flags = {}) {
    return new Promise(async (resolve, reject) => {
      let headers = {
        "User-Agent": "BinanceAPI",
        "Content-type": "application/x-www-form-urlencoded",
      };

      if (flags.type === "SIGNED") {
        data.timestamp = Date.now();
        const queryString = this.#makeQueryString(data);
        data.signature = this.#sign(data);
        endpoint += `?${queryString}&signature=${data.signature}`;
      }

      const url = `${this.#urls.futures.fapi}${endpoint}`;
      try {
        const response = await axios({
          method: flags.method || "GET",
          url: url,
          headers: headers,
          params: data,
          timeout: options.recvWindow,
        });
        resolve(response.data);
      } catch (error) {
        reject(error);
      }
    });
  }

  #makeQueryString(data) {
    return Object.keys(data)
      .map((key) => `${key}=${data[key]}`)
      .join("&");
  }
}

export default BinanceAPI;
