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

  constructor(config) {
    this.#apiKey = config.APIKEY;
    this.#apiSecret = config.APISECRET;
    const defaultUrls = {
      production: {
        base: "https://api.binance.com/api/",
        wapi: "https://api.binance.com/wapi/",
        sapi: "https://api.binance.com/sapi/",
        futures: {
          base: "https://fapi.binance.com",
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
    this.#environment = config.environment || "production"; // Default to production, can be testnet or sandbox
    this.#urls = {
      ...defaultUrls[this.#environment],
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
          throw error;
        });

        ws.on("close", () => {
          if (pingInterval & pingInterval.startPing) {
            clearInterval(pingInterval.startPing());
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
          } else if (this.#reconnect) {
            throw new Error(
              `Failed to reconnect after ${
                this.#maxReconnectAttempts
              } attempts.`
            );
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
        if (retries < this.#maxListenKeyRetries) {
          console.log(
            `Retrying ${type} listen key renewal (${retries + 1}/${
              this.#maxListenKeyRetries
            })...`
          );
          retries++;
        } else {
          clearInterval(renewInterval);
          throw new Error(
            `Max retries for ${type} listen key renewal exceeded.`
          );
        }
      }
    }, 15 * 60 * 1000); // Renew every 15 minutes

    // Close WebSocket connection and generate a new listen key every 24 hours
    setInterval(async () => {
      console.log("Renewing listen key...");
      ws.close();
      this.#listenKey = await this.#generateListenKey("futures");
    }, 24 * 60 * 60 * 1000); // 24 hours
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
}

export default BinanceAPI;
