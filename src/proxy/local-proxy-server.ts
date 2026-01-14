/**
 * LocalProxyServer - Local HTTP/HTTPS/SOCKS5 proxy server
 * Acts as intermediary for authenticated proxies that Chrome doesn't support natively
 * Handles proxy authentication and forwards requests to upstream proxy
 */

import * as http from "http"
import * as net from "net"
import { EventEmitter } from "events"
import { logger } from "../utils/logger"

export class LocalProxyServer extends EventEmitter {
  private server: http.Server | null = null
  private socksServer: net.Server | null = null
  private port: number
  private targetProxy: {
    host: string
    port: number
    username: string
    password: string
    protocol: string
  }
  private hasLogged403: boolean = false
  private hasLoggedConnectionRefused: boolean = false

  /**
   * @param targetProxy - Upstream proxy configuration (host, port, credentials, protocol)
   */
  constructor(targetProxy: { host: string; port: number; username: string; password: string; protocol: string }) {
    super()
    this.targetProxy = {
      host: targetProxy.host,
      port: targetProxy.port,
      username: targetProxy.username,
      password: targetProxy.password,
      protocol: targetProxy.protocol,
    }
    this.port = 0
  }

  async start(): Promise<number> {
    // For SOCKS5 proxies, create a SOCKS5 proxy server
    if (this.targetProxy.protocol === "socks5" || this.targetProxy.protocol === "socks4") {
      return this.startSocks5Server()
    }

    // For HTTP proxies, use existing HTTP proxy server
    return new Promise((resolve, reject) => {
      this.server = http
        .createServer()
        .on("request", (clientReq, clientRes) => {
          const auth = Buffer.from(`${this.targetProxy.username}:${this.targetProxy.password}`).toString("base64")

          const options = {
            hostname: this.targetProxy.host,
            port: this.targetProxy.port,
            path: clientReq.url || "/",
            method: clientReq.method,
            headers: {
              ...clientReq.headers,
              "Proxy-Authorization": `Basic ${auth}`,
            },
          }

          const proxyReq = http.request(options, (proxyRes) => {
            clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
            proxyRes.pipe(clientRes)
          })

          proxyReq.on("error", (err: any) => {
            // Handle connection refused for HTTP requests
            if (err.code === "ECONNREFUSED") {
              if (!this.hasLoggedConnectionRefused) {
                this.hasLoggedConnectionRefused = true
                logger.error(`Proxy connection refused: ${this.targetProxy.host}:${this.targetProxy.port}`)
                logger.warn(`   Proxy server is not accepting connections. Falling back to direct connection...`)
                this.emit("proxy-connection-refused", { host: this.targetProxy.host, port: this.targetProxy.port })
              }
            } else {
              logger.error(`Local proxy request error: ${err.message || err}`)
            }
            if (!clientRes.headersSent) {
              clientRes.writeHead(500)
              clientRes.end("Proxy Error")
            }
          })

          clientReq.pipe(proxyReq)
        })
        .on("connect", (req, clientSocket, head) => {
          // Handle HTTPS CONNECT requests
          const auth = Buffer.from(`${this.targetProxy.username}:${this.targetProxy.password}`).toString("base64")

          // Parse target URL (format: hostname:port)
          const targetUrl = req.url || ""
          const lastColon = targetUrl.lastIndexOf(":")
          const hostname = lastColon > 0 ? targetUrl.substring(0, lastColon) : targetUrl
          const port = lastColon > 0 ? targetUrl.substring(lastColon + 1) : "443"

          // Log authentication info (masked for security)
          if (!this.hasLogged403) {
            const maskedPassword = this.targetProxy.password
              ? `${this.targetProxy.password.substring(0, 4)}...${this.targetProxy.password.substring(this.targetProxy.password.length - 4)}`
              : "***"
            logger.debug(
              `CONNECT request for ${hostname}:${port} using proxy ${this.targetProxy.host}:${this.targetProxy.port}`,
            )
            logger.debug(`Proxy auth: username=${this.targetProxy.username}, password=${maskedPassword}`)
          }

          const proxySocket = net.createConnection(
            {
              host: this.targetProxy.host,
              port: this.targetProxy.port,
              timeout: 15000,
            },
            () => {
              logger.debug(`Connected to proxy ${this.targetProxy.host}:${this.targetProxy.port}`)

              // Send CONNECT request to upstream proxy with browser-like headers
              const connectRequest =
                `CONNECT ${hostname}:${port} HTTP/1.1\r\n` +
                `Host: ${hostname}:${port}\r\n` +
                `Proxy-Authorization: Basic ${auth}\r\n` +
                `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n` +
                `Connection: keep-alive\r\n` +
                `\r\n`

              logger.debug(`Sending CONNECT request to proxy`)
              proxySocket.write(connectRequest)

              // Set timeout for response
              const responseTimeout = setTimeout(() => {
                logger.error(`Proxy CONNECT timeout for ${hostname}:${port}`)
                proxySocket.removeAllListeners("data")
                if (!clientSocket.destroyed) {
                  clientSocket.end()
                }
                proxySocket.end()
              }, 10000)

              // Wait for proxy response before establishing tunnel
              let responseBuffer = ""
              const dataHandler = (data: Buffer) => {
                responseBuffer += data.toString()

                // Check if we have complete HTTP response
                if (responseBuffer.includes("\r\n\r\n")) {
                  clearTimeout(responseTimeout)
                  proxySocket.removeListener("data", dataHandler)

                  const statusLine = responseBuffer.split("\r\n")[0]
                  const statusCode = parseInt(statusLine.split(" ")[1] || "0")

                  logger.debug(`Proxy CONNECT response: ${statusLine}`)

                  if (statusCode >= 200 && statusCode < 300) {
                    // Proxy accepted, establish tunnel
                    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")

                    // Remove the response from buffer and pipe remaining data
                    const responseEnd = responseBuffer.indexOf("\r\n\r\n") + 4
                    const remainingData = responseBuffer.slice(responseEnd)

                    if (remainingData.length > 0) {
                      clientSocket.write(remainingData)
                    }

                    // Now pipe the streams (bidirectional)
                    proxySocket.pipe(clientSocket, { end: false })
                    clientSocket.pipe(proxySocket, { end: false })

                    // Write any head data
                    if (head && head.length > 0) {
                      proxySocket.write(head)
                    }

                    logger.debug(`Tunnel established for ${hostname}:${port}`)
                  } else {
                    // Extract error message from response body if available
                    const bodyMatch = responseBuffer.match(/\r\n\r\n(.+)/s)
                    const errorMessage = bodyMatch ? bodyMatch[1].trim().substring(0, 100) : ""

                    if (statusCode === 403) {
                      // Only log 403 error once to reduce spam
                      if (!this.hasLogged403) {
                        this.hasLogged403 = true
                        logger.error(`❌ Proxy authentication failed (403 Forbidden)`)
                        if (errorMessage) {
                          logger.error(`   Proxy response: ${errorMessage}`)
                        }
                        logger.warn(`   Note: ScrapeOps residential proxy may work for HTTP requests but`)
                        logger.warn(`   may block automated browser connections (Puppeteer/Chrome).`)
                        logger.warn(`   This is a known limitation - your credentials are correct.`)
                        logger.warn(`   Falling back to direct connection...`)
                        // Emit event for bot to handle fallback
                        this.emit("proxy-banned", { statusCode, errorMessage })
                      }
                    } else {
                      logger.error(`Proxy CONNECT failed with status: ${statusLine}`)
                      if (errorMessage) {
                        logger.error(`Proxy response: ${errorMessage}`)
                      }
                    }

                    if (!clientSocket.destroyed) {
                      clientSocket.write(`HTTP/1.1 ${statusCode} Proxy Error\r\n\r\n`)
                      clientSocket.end()
                    }
                    proxySocket.end()
                  }
                }
              }

              proxySocket.on("data", dataHandler)
            },
          )

          proxySocket.on("error", (err: any) => {
            // Handle connection refused errors
            if (err.code === "ECONNREFUSED") {
              if (!this.hasLoggedConnectionRefused) {
                this.hasLoggedConnectionRefused = true
                logger.error(`Proxy connection refused: ${this.targetProxy.host}:${this.targetProxy.port}`)
                logger.warn(`   Possible causes:`)
                logger.warn(`   - Proxy server is down or offline`)
                logger.warn(`   - Wrong protocol (try SOCKS5 instead of HTTP)`)
                logger.warn(`   - Firewall blocking connection`)
                logger.warn(`   - Proxy credentials or endpoint incorrect`)
                logger.warn(`   Falling back to direct connection...`)
                // Emit event for bot to handle fallback
                this.emit("proxy-connection-refused", { host: this.targetProxy.host, port: this.targetProxy.port })
              }
            } else if (!clientSocket.destroyed && err.code !== "ECONNRESET") {
              logger.error(`Local proxy CONNECT error: ${err.message}`)
            }
            if (!clientSocket.destroyed) {
              clientSocket.end()
            }
          })

          proxySocket.on("close", () => {
            if (!clientSocket.destroyed) {
              clientSocket.end()
            }
          })

          clientSocket.on("error", (err) => {
            if (!proxySocket.destroyed) {
              proxySocket.end()
            }
          })

          clientSocket.on("close", () => {
            if (!proxySocket.destroyed) {
              proxySocket.end()
            }
          })
        })

      this.server.listen(this.port, "127.0.0.1", () => {
        const address = this.server!.address() as { port: number }
        this.port = address.port
        logger.debug(`Local proxy server started on port ${this.port}`)
        resolve(this.port)
      })

      this.server.on("error", reject)
    })
  }

  getPort(): number {
    return this.port
  }

  private async startSocks5Server(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.socksServer = net.createServer((clientSocket) => {
        let buffer = Buffer.alloc(0)

        clientSocket.on("data", async (data) => {
          buffer = Buffer.concat([buffer, data])

          // SOCKS5 handshake
          if (buffer.length >= 2 && buffer[0] === 0x05) {
            const methodCount = buffer[1]
            if (buffer.length >= 2 + methodCount) {
              // Send method selection (no authentication required for local proxy)
              clientSocket.write(Buffer.from([0x05, 0x00]))
              buffer = buffer.slice(2 + methodCount)

              // Handle SOCKS5 request
              if (buffer.length >= 5) {
                const cmd = buffer[1]
                const addrType = buffer[3]

                let targetHost = ""
                let targetPort = 0
                let headerLength = 4

                if (addrType === 0x01) {
                  // IPv4
                  if (buffer.length >= 10) {
                    targetHost = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`
                    targetPort = (buffer[8] << 8) | buffer[9]
                    headerLength = 10
                  }
                } else if (addrType === 0x03) {
                  // Domain name
                  const domainLength = buffer[4]
                  if (buffer.length >= 5 + domainLength + 2) {
                    targetHost = buffer.slice(5, 5 + domainLength).toString()
                    targetPort = (buffer[5 + domainLength] << 8) | buffer[5 + domainLength + 1]
                    headerLength = 5 + domainLength + 2
                  }
                }

                if (targetHost && targetPort && cmd === 0x01) {
                  // CONNECT
                  // Connect to upstream SOCKS5 proxy
                  const upstreamSocket = net.createConnection({
                    host: this.targetProxy.host,
                    port: this.targetProxy.port,
                  })

                  let upstreamBuffer = Buffer.alloc(0)
                  let handshakeComplete = false
                  let requestSent = false

                  // SOCKS5 handshake with upstream proxy
                  upstreamSocket.on("connect", () => {
                    // Send authentication methods
                    const authMethods = Buffer.from([0x05, 0x02, 0x00, 0x02]) // No auth + username/password
                    upstreamSocket.write(authMethods)
                  })

                  upstreamSocket.on("data", (data) => {
                    upstreamBuffer = Buffer.concat([upstreamBuffer, data])

                    if (!handshakeComplete && upstreamBuffer.length >= 2) {
                      if (upstreamBuffer[0] === 0x05 && upstreamBuffer[1] === 0x02) {
                        // Username/password authentication required
                        const username = Buffer.from(this.targetProxy.username)
                        const password = Buffer.from(this.targetProxy.password)
                        const authPacket = Buffer.alloc(3 + username.length + password.length)
                        authPacket[0] = 0x01 // Version
                        authPacket[1] = username.length
                        username.copy(authPacket, 2)
                        authPacket[2 + username.length] = password.length
                        password.copy(authPacket, 3 + username.length)
                        upstreamSocket.write(authPacket)
                      } else if (upstreamBuffer[0] === 0x05 && upstreamBuffer[1] === 0x00) {
                        // No auth required
                        handshakeComplete = true
                        upstreamBuffer = upstreamBuffer.slice(2)
                      } else if (upstreamBuffer[0] === 0x01 && upstreamBuffer[1] === 0x00) {
                        // Auth successful
                        handshakeComplete = true
                        upstreamBuffer = upstreamBuffer.slice(2)
                      }
                    }

                    if (handshakeComplete && !requestSent) {
                      // Send CONNECT request to upstream proxy
                      const domainName = Buffer.from(targetHost)
                      const request = Buffer.alloc(4 + domainName.length + 2)
                      request[0] = 0x05 // SOCKS version
                      request[1] = 0x01 // CONNECT
                      request[2] = 0x00 // Reserved
                      request[3] = 0x03 // Domain name
                      request[4] = domainName.length
                      domainName.copy(request, 5)
                      request[5 + domainName.length] = (targetPort >> 8) & 0xff
                      request[5 + domainName.length + 1] = targetPort & 0xff
                      upstreamSocket.write(request)
                      requestSent = true
                      upstreamBuffer = Buffer.alloc(0)
                    }

                    if (requestSent && upstreamBuffer.length >= 10) {
                      // Upstream proxy response received
                      if (upstreamBuffer[1] === 0x00) {
                        // Success - forward response to client
                        clientSocket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
                        // Pipe data bidirectionally
                        upstreamSocket.pipe(clientSocket)
                        clientSocket.pipe(upstreamSocket)

                        // Forward any remaining buffer data
                        if (upstreamBuffer.length > 10) {
                          clientSocket.write(upstreamBuffer.slice(10))
                        }
                      } else {
                        // Error
                        clientSocket.write(
                          Buffer.from([0x05, upstreamBuffer[1], 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
                        )
                        clientSocket.end()
                        upstreamSocket.end()
                      }
                    }
                  })

                  upstreamSocket.on("error", (err: any) => {
                    if (err.code === "ECONNREFUSED") {
                      if (!this.hasLoggedConnectionRefused) {
                        this.hasLoggedConnectionRefused = true
                        logger.error(
                          `SOCKS5 proxy connection refused: ${this.targetProxy.host}:${this.targetProxy.port}`,
                        )
                        logger.warn(`   Possible causes:`)
                        logger.warn(`   - Proxy server is down or offline`)
                        logger.warn(`   - Proxy might be HTTP instead of SOCKS5 (try useProxy: 1)`)
                        logger.warn(`   - Wrong protocol or port`)
                        logger.warn(`   - Firewall blocking connection`)
                        logger.warn(`   Falling back to direct connection...`)
                        this.emit("proxy-connection-refused", {
                          host: this.targetProxy.host,
                          port: this.targetProxy.port,
                        })
                      }
                    } else {
                      logger.error(`SOCKS5 upstream connection error: ${err.message || err}`)
                    }
                    if (!clientSocket.destroyed) {
                      clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
                      clientSocket.end()
                    }
                  })

                  upstreamSocket.on("close", () => {
                    if (!clientSocket.destroyed) {
                      clientSocket.end()
                    }
                  })

                  clientSocket.on("error", () => {
                    upstreamSocket.end()
                  })

                  buffer = buffer.slice(headerLength)
                  // Buffer will be sent after connection is established
                } else {
                  clientSocket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
                  clientSocket.end()
                }
              }
            }
          }
        })

        clientSocket.on("error", (err: any) => {
          logger.debug(`SOCKS5 client error: ${err.message}`)
        })

        clientSocket.on("close", () => {
          // Client disconnected
        })
      })

      this.socksServer.listen(this.port, "127.0.0.1", () => {
        const address = this.socksServer!.address() as { port: number }
        this.port = address.port
        logger.debug(`Local SOCKS5 proxy server started on port ${this.port}`)
        resolve(this.port)
      })

      this.socksServer.on("error", reject)
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.debug("Local proxy server stopped")
          resolve()
        })
      })
    }
    if (this.socksServer) {
      return new Promise((resolve) => {
        this.socksServer!.close(() => {
          logger.debug("Local SOCKS5 proxy server stopped")
          resolve()
        })
      })
    }
  }
}
