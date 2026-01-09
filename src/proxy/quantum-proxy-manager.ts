import axios, { type AxiosInstance } from "axios"
import { SocksProxyAgent } from "socks-proxy-agent"
import * as net from "net"
import * as dns from "dns"
import { promisify } from "util"
import { logger } from "../utils/logger"
import type { QuantumProxyConfig, ConnectionMetrics } from "../types"

const dnsLookup = promisify(dns.lookup)

interface SmartConnection {
  proxy: QuantumProxyConfig
  metrics: ConnectionMetrics
  axiosInstance: AxiosInstance
  lastUsed: number
  connectionPool: AxiosInstance[]
  dnsCache: Map<string, { ip: string; ttl: number }>
}

// AI-like proxy intelligence data structures
interface ProxyIntelligence {
  proxyKey: string
  successRate: number
  averageResponseTime: number
  lastUsed: number
  consecutiveFailures: number
  totalRequests: number
  totalSuccesses: number
  backoffUntil: number
  optimalUsageWindow: { start: number; end: number } | null
  riskScore: number // 0-100, higher = more risky
  adaptiveCooldown: number // ms between requests
}

interface RequestPattern {
  timestamp: number
  success: boolean
  responseTime: number
  statusCode: number
  proxyKey: string
}

export class QuantumProxyManager {
  private connections: Map<string, SmartConnection> = new Map()
  private currentConnection: SmartConnection | null = null
  private connectionPoolSize = 3
  private dnsCache = new Map<string, { ip: string; expires: number }>()
  private dnsCacheTTL = 300000
  private keepAliveInterval: NodeJS.Timeout | null = null

  // AI Intelligence Layer
  private proxyIntelligence = new Map<string, ProxyIntelligence>()
  private requestHistory: RequestPattern[] = []
  private maxHistorySize = 1000
  private adaptiveRotationInterval: NodeJS.Timeout | null = null
  private last429Error = 0
  private globalRateLimit = { requests: 0, window: 60000, maxRequests: 30 } // 30 requests per minute

  constructor(private targetDomain = "act.playcfl.com") {
    // Pure proxy management - no security features
    this.startAdaptiveRotation()
  }

  /**
   * AI-powered proxy selection using predictive analytics
   */
  private selectOptimalProxy(): SmartConnection | null {
    if (this.connections.size === 0) return null

    const now = Date.now()
    const candidates = Array.from(this.connections.values()).filter((conn) => {
      const intel = this.proxyIntelligence.get(conn.proxy.host + ":" + conn.proxy.port)
      // Skip proxies in backoff
      if (intel && intel.backoffUntil > now) return false
      // Skip high-risk proxies
      if (intel && intel.riskScore > 80) return false
      return true
    })

    if (candidates.length === 0) return this.currentConnection

    // Score each proxy using AI-like intelligence
    const scored = candidates.map((conn) => {
      const key = conn.proxy.host + ":" + conn.proxy.port
      const intel = this.proxyIntelligence.get(key) || this.initializeProxyIntelligence(key)

      let score = 0

      // Success rate (40% weight)
      score += intel.successRate * 0.4

      // Response time (inverse - faster is better) (25% weight)
      const speedScore = Math.max(0, 100 - intel.averageResponseTime / 10)
      score += speedScore * 0.25

      // Risk assessment (inverse - lower risk is better) (20% weight)
      score += (100 - intel.riskScore) * 0.2

      // Recency bonus (15% weight) - prefer recently successful proxies
      const hoursSinceLastUse = (now - intel.lastUsed) / (1000 * 60 * 60)
      const recencyScore = Math.max(0, 100 - hoursSinceLastUse * 10)
      score += recencyScore * 0.15

      return { connection: conn, score, intelligence: intel }
    })

    // Select the highest scoring proxy
    scored.sort((a, b) => b.score - a.score)
    const winner = scored[0]

    logger.debug(
      `🤖 AI Proxy Selection: ${winner.connection.proxy.host}:${winner.connection.proxy.port} (score: ${winner.score.toFixed(1)}, risk: ${winner.intelligence.riskScore})`,
    )

    return winner.connection
  }

  /**
   * Learn from request outcomes and update proxy intelligence
   */
  private learnFromRequest(proxyKey: string, success: boolean, responseTime: number, statusCode: number): void {
    const pattern: RequestPattern = {
      timestamp: Date.now(),
      success,
      responseTime,
      statusCode,
      proxyKey,
    }

    // Add to history
    this.requestHistory.push(pattern)
    if (this.requestHistory.length > this.maxHistorySize) {
      this.requestHistory.shift()
    }

    // Update proxy intelligence
    const intel = this.proxyIntelligence.get(proxyKey) || this.initializeProxyIntelligence(proxyKey)
    intel.lastUsed = Date.now()
    intel.totalRequests++

    if (success) {
      intel.totalSuccesses++
      intel.consecutiveFailures = 0
      // Update response time (exponential moving average)
      intel.averageResponseTime = intel.averageResponseTime * 0.7 + responseTime * 0.3
    } else {
      intel.consecutiveFailures++
      // Handle rate limiting
      if (statusCode === 429) {
        this.last429Error = Date.now()
        intel.backoffUntil = Date.now() + intel.adaptiveCooldown * 2
        intel.adaptiveCooldown = Math.min(intel.adaptiveCooldown * 2, 300000) // Max 5 minutes
        logger.warn(`🤖 AI: 429 detected on ${proxyKey}, backoff ${intel.adaptiveCooldown}ms`)
      }
    }

    // Recalculate success rate
    intel.successRate = (intel.totalSuccesses / intel.totalRequests) * 100

    // Update risk score based on failure patterns
    this.updateRiskAssessment(intel, statusCode)

    // Learn optimal usage patterns
    this.learnUsagePatterns(intel)

    this.proxyIntelligence.set(proxyKey, intel)
  }

  /**
   * Initialize intelligence data for a new proxy
   */
  private initializeProxyIntelligence(proxyKey: string): ProxyIntelligence {
    return {
      proxyKey,
      successRate: 100, // Start optimistic
      averageResponseTime: 1000, // 1 second baseline
      lastUsed: Date.now(),
      consecutiveFailures: 0,
      totalRequests: 0,
      totalSuccesses: 0,
      backoffUntil: 0,
      optimalUsageWindow: null,
      riskScore: 20, // Start with low risk
      adaptiveCooldown: 5000, // 5 seconds baseline
    }
  }

  /**
   * Update risk assessment based on failure patterns
   */
  private updateRiskAssessment(intel: ProxyIntelligence, statusCode: number): void {
    let riskIncrease = 0

    if (statusCode === 429) riskIncrease += 30
    else if (statusCode >= 500) riskIncrease += 20
    else if (statusCode >= 400) riskIncrease += 10

    if (intel.consecutiveFailures > 3) riskIncrease += intel.consecutiveFailures * 5

    intel.riskScore = Math.min(100, intel.riskScore + riskIncrease)

    // Recovery: decrease risk for successful requests
    if (intel.consecutiveFailures === 0 && intel.successRate > 80) {
      intel.riskScore = Math.max(0, intel.riskScore - 5)
    }
  }

  /**
   * Learn optimal usage time windows for proxies
   */
  private learnUsagePatterns(intel: ProxyIntelligence): void {
    const recentPatterns = this.requestHistory.filter((p) => p.proxyKey === intel.proxyKey).slice(-50) // Last 50 requests

    if (recentPatterns.length < 20) return // Need enough data

    // Analyze success rates by hour of day
    const hourlyStats = new Map<number, { total: number; success: number }>()

    recentPatterns.forEach((pattern) => {
      const hour = new Date(pattern.timestamp).getHours()
      const stats = hourlyStats.get(hour) || { total: 0, success: 0 }
      stats.total++
      if (pattern.success) stats.success++
      hourlyStats.set(hour, stats)
    })

    // Find best performing hour
    let bestHour = -1
    let bestSuccessRate = 0

    hourlyStats.forEach((stats, hour) => {
      const rate = (stats.success / stats.total) * 100
      if (rate > bestSuccessRate && stats.total >= 5) {
        // At least 5 requests
        bestSuccessRate = rate
        bestHour = hour
      }
    })

    if (bestHour !== -1) {
      intel.optimalUsageWindow = {
        start: bestHour,
        end: (bestHour + 1) % 24,
      }
    }
  }

  /**
   * Global rate limiting to prevent 429 errors
   */
  private checkGlobalRateLimit(): boolean {
    const now = Date.now()

    // Reset window if needed
    if (
      now - this.globalRateLimit.requests * (this.globalRateLimit.window / this.globalRateLimit.maxRequests) >
      this.globalRateLimit.window
    ) {
      this.globalRateLimit.requests = 0
    }

    if (this.globalRateLimit.requests >= this.globalRateLimit.maxRequests) {
      logger.warn(
        `🤖 AI: Global rate limit reached (${this.globalRateLimit.requests}/${this.globalRateLimit.maxRequests})`,
      )
      return false
    }

    this.globalRateLimit.requests++
    return true
  }

  /**
   * Start adaptive rotation with AI intelligence
   */
  private startAdaptiveRotation(): void {
    if (this.adaptiveRotationInterval) {
      clearInterval(this.adaptiveRotationInterval)
    }

    // Adaptive rotation every 30-120 seconds based on performance
    this.adaptiveRotationInterval = setInterval(() => {
      this.performAdaptiveRotation()
    }, 30000)
  }

  /**
   * AI-driven adaptive rotation
   */
  private async performAdaptiveRotation(): Promise<void> {
    if (this.connections.size < 2) return

    const currentIntel = this.currentConnection
      ? this.proxyIntelligence.get(this.currentConnection.proxy.host + ":" + this.currentConnection.proxy.port)
      : null

    // Force rotation if current proxy has high risk or poor performance
    if (currentIntel && (currentIntel.riskScore > 70 || currentIntel.consecutiveFailures > 2)) {
      logger.info(
        `🤖 AI: Rotating due to high risk (${currentIntel.riskScore}) or failures (${currentIntel.consecutiveFailures})`,
      )
      await this.forceSmartRotation()
      return
    }

    // Proactive rotation to maintain optimal performance
    const optimalProxy = this.selectOptimalProxy()
    if (optimalProxy && optimalProxy !== this.currentConnection) {
      const optimalIntel = this.proxyIntelligence.get(optimalProxy.proxy.host + ":" + optimalProxy.proxy.port)
      if (optimalIntel && optimalIntel.successRate > (currentIntel?.successRate || 0) + 10) {
        logger.info(
          `🤖 AI: Proactive rotation to better proxy (${optimalIntel.successRate.toFixed(1)}% vs ${(currentIntel?.successRate || 0).toFixed(1)}%)`,
        )
        this.currentConnection = optimalProxy
      }
    }
  }

  /**
   * Force rotation to best available proxy
   */
  private async forceSmartRotation(): Promise<boolean> {
    const bestProxy = this.selectOptimalProxy()
    if (bestProxy && bestProxy !== this.currentConnection) {
      logger.info(`🤖 AI: Force rotating to ${bestProxy.proxy.host}:${bestProxy.proxy.port}`)
      this.currentConnection = bestProxy
      return true
    }
    return false
  }

  async initializeQuantumConnection(proxyConfig: QuantumProxyConfig): Promise<boolean> {
    const connectionKey = `${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`

    try {
      logger.debug(`Initializing quantum connection for ${connectionKey}`)

      await this.quantumDNSResolve(this.targetDomain)

      const connection: SmartConnection = {
        proxy: proxyConfig,
        metrics: await this.measureConnectionQuality(proxyConfig),
        axiosInstance: this.createOptimizedAxiosInstance(proxyConfig),
        lastUsed: Date.now(),
        connectionPool: [],
        dnsCache: new Map(),
      }

      connection.connectionPool = await this.createConnectionPool(proxyConfig, this.connectionPoolSize)

      const quantumTest = await this.performQuantumConnectivityTest(connection)
      if (!quantumTest) {
        logger.error(`Quantum connection test failed for ${connectionKey}`)
        return false
      }

      this.connections.set(connectionKey, connection)
      this.currentConnection = connection

      logger.success(`Quantum connection established: stability ${connection.metrics.stability}/100`)
      return true
    } catch (error) {
      logger.error(`Quantum connection initialization failed: ${error}`)
      return false
    }
  }

  private async quantumDNSResolve(domain: string): Promise<string> {
    const cached = this.dnsCache.get(domain)
    if (cached && cached.expires > Date.now()) {
      return cached.ip
    }

    try {
      const { address } = await dnsLookup(domain)
      this.dnsCache.set(domain, {
        ip: address,
        expires: Date.now() + this.dnsCacheTTL,
      })
      return address
    } catch (error) {
      if (cached) {
        logger.warn(`DNS lookup failed, using cached IP: ${cached.ip}`)
        return cached.ip
      }
      throw error
    }
  }

  private async measureConnectionQuality(proxy: QuantumProxyConfig): Promise<ConnectionMetrics> {
    const metrics: ConnectionMetrics = {
      latency: 0,
      jitter: 0,
      packetLoss: 0,
      bandwidth: 0,
      lastTested: Date.now(),
      stability: 0,
    }

    try {
      const tcpStart = Date.now()
      const tcpSuccess = await this.testTCPHandshake(proxy)
      const tcpTime = Date.now() - tcpStart

      if (!tcpSuccess) {
        return { ...metrics, stability: 0 }
      }

      const httpSamples = []
      for (let i = 0; i < 5; i++) {
        const start = Date.now()
        const success = await this.testHTTPConnectivity(proxy)
        const time = Date.now() - start
        if (success) httpSamples.push(time)
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      if (httpSamples.length === 0) {
        return { ...metrics, stability: 10 }
      }

      metrics.latency = httpSamples.reduce((a, b) => a + b) / httpSamples.length
      metrics.jitter = this.calculateJitter(httpSamples)
      metrics.packetLoss = ((5 - httpSamples.length) / 5) * 100

      const latencyScore = Math.max(0, 100 - metrics.latency / 10)
      const jitterScore = Math.max(0, 100 - metrics.jitter * 10)
      const lossScore = 100 - metrics.packetLoss

      metrics.stability = Math.round((latencyScore + jitterScore + lossScore) / 3)
    } catch (error) {
      metrics.stability = 0
    }

    return metrics
  }

  private createOptimizedAxiosInstance(proxy: QuantumProxyConfig): AxiosInstance {
    let agent: any

    if (proxy.protocol === "socks4" || proxy.protocol === "socks5") {
      let socksUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`
      // Add authentication if username and password are provided
      if (proxy.username && proxy.password) {
        socksUrl = `${proxy.protocol}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
      }
      agent = new SocksProxyAgent(socksUrl)
    }

    return axios.create({
      proxy: proxy.protocol.startsWith("http")
        ? {
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol,
            auth:
              proxy.username && proxy.password
                ? {
                    username: proxy.username,
                    password: proxy.password,
                  }
                : undefined,
          }
        : undefined,
      httpAgent: agent,
      httpsAgent: agent,
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
    })
  }

  private async createConnectionPool(proxy: QuantumProxyConfig, poolSize: number): Promise<AxiosInstance[]> {
    const pool: AxiosInstance[] = []

    for (let i = 0; i < poolSize; i++) {
      const instance = this.createOptimizedAxiosInstance(proxy)
      try {
        await instance.get("http://httpbin.org/status/200", { timeout: 3000 })
        pool.push(instance)
      } catch (error) {
        // Connection failed, skip
      }
    }

    logger.debug(`Created connection pool with ${pool.length}/${poolSize} instances`)
    return pool
  }

  private async performQuantumConnectivityTest(connection: SmartConnection): Promise<boolean> {
    try {
      const handshakeSuccess = await this.simulateThreeWayHandshake(connection.proxy)
      if (!handshakeSuccess) return false

      const chunkedSuccess = await this.testChunkedRequests(connection)
      if (!chunkedSuccess) return false

      const seedingSuccess = await this.performConnectionSeeding(connection)
      if (!seedingSuccess) return false

      return true
    } catch (error) {
      return false
    }
  }

  private async simulateThreeWayHandshake(proxy: QuantumProxyConfig): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({
        host: proxy.host,
        port: proxy.port,
        timeout: 5000,
      })

      const startTime = Date.now()

      socket.on("connect", () => {
        const handshakeTime = Date.now() - startTime
        socket.end()
        resolve(handshakeTime < 3000)
      })

      socket.on("error", () => resolve(false))
      socket.on("timeout", () => {
        socket.destroy()
        resolve(false)
      })
    })
  }

  private async testChunkedRequests(connection: SmartConnection): Promise<boolean> {
    try {
      const response = await connection.axiosInstance.get("http://httpbin.org/stream/5", {
        timeout: 10000,
        responseType: "stream",
      })

      return response.status === 200
    } catch (error) {
      return false
    }
  }

  private async performConnectionSeeding(connection: SmartConnection): Promise<boolean> {
    const seedRequests = ["http://httpbin.org/status/200", "http://httpbin.org/json", "http://httpbin.org/headers"]

    try {
      const promises = seedRequests.map((url) => connection.axiosInstance.get(url, { timeout: 3000 }))

      const results = await Promise.allSettled(promises)
      const successCount = results.filter(
        (result) => result.status === "fulfilled" && result.value.status === 200,
      ).length

      return successCount >= 2
    } catch (error) {
      return false
    }
  }

  async getOptimizedConnection(): Promise<AxiosInstance | null> {
    if (!this.currentConnection) return null

    // AI Rate limiting check
    if (!this.checkGlobalRateLimit()) {
      logger.warn(`🤖 AI: Request blocked by global rate limiting`)
      return null
    }

    // Check if current proxy is in backoff
    const proxyKey = this.currentConnection.proxy.host + ":" + this.currentConnection.proxy.port
    const intel = this.proxyIntelligence.get(proxyKey)
    if (intel && intel.backoffUntil > Date.now()) {
      logger.debug(`🤖 AI: Proxy ${proxyKey} in backoff, switching...`)
      await this.forceSmartRotation()
      // Retry with new proxy
      return this.getOptimizedConnection()
    }

    // Check optimal usage window
    if (intel?.optimalUsageWindow) {
      const currentHour = new Date().getHours()
      const inWindow = currentHour >= intel.optimalUsageWindow.start && currentHour < intel.optimalUsageWindow.end
      if (!inWindow && Math.random() < 0.3) {
        // 30% chance to rotate out of optimal window
        logger.debug(`🤖 AI: Outside optimal usage window, considering rotation`)
        const betterProxy = this.selectOptimalProxy()
        if (betterProxy !== this.currentConnection) {
          this.currentConnection = betterProxy
        }
      }
    }

    this.currentConnection!.lastUsed = Date.now()

    if (this.currentConnection!.connectionPool.length > 0) {
      const connection = this.currentConnection!.connectionPool.shift()!
      this.currentConnection!.connectionPool.push(connection)
      return connection
    }

    return this.currentConnection!.axiosInstance
  }

  /**
   * AI-powered request execution with learning
   */
  async executeSmartRequest(config: any): Promise<any> {
    const startTime = Date.now()
    const proxyKey = this.currentConnection
      ? this.currentConnection.proxy.host + ":" + this.currentConnection.proxy.port
      : "direct"

    try {
      const instance = await this.getOptimizedConnection()
      if (!instance) {
        throw new Error("No proxy connection available")
      }

      const response = await instance(config)
      const responseTime = Date.now() - startTime

      // Learn from success
      this.learnFromRequest(proxyKey, true, responseTime, response.status)

      return response
    } catch (error: any) {
      const responseTime = Date.now() - startTime
      const statusCode = error.response?.status || 0

      // Learn from failure
      this.learnFromRequest(proxyKey, false, responseTime, statusCode)

      // If 429 error, implement intelligent backoff
      if (statusCode === 429) {
        const intel = this.proxyIntelligence.get(proxyKey)
        if (intel) {
          const backoffTime = Math.min(intel.adaptiveCooldown * 2, 300000) // Max 5 minutes
          intel.backoffUntil = Date.now() + backoffTime
          logger.warn(`🤖 AI: 429 detected, backing off ${proxyKey} for ${backoffTime}ms`)
        }
      }

      throw error
    }
  }

  async switchToBestProxy(): Promise<boolean> {
    const optimalConnection = this.selectOptimalProxy()

    if (optimalConnection && optimalConnection !== this.currentConnection) {
      const oldKey = this.currentConnection
        ? `${this.currentConnection.proxy.host}:${this.currentConnection.proxy.port}`
        : "none"
      const newKey = `${optimalConnection.proxy.host}:${optimalConnection.proxy.port}`

      this.currentConnection = optimalConnection

      const intel = this.proxyIntelligence.get(newKey)
      logger.info(
        `🤖 AI: Switched to optimal proxy ${newKey} (success: ${intel?.successRate.toFixed(1)}%, risk: ${intel?.riskScore})`,
      )
      return true
    }

    return false
  }

  private async testTCPHandshake(proxy: QuantumProxyConfig): Promise<boolean> {
    return this.simulateThreeWayHandshake(proxy)
  }

  private async testHTTPConnectivity(proxy: QuantumProxyConfig): Promise<boolean> {
    try {
      const instance = this.createOptimizedAxiosInstance(proxy)
      const response = await instance.get("http://httpbin.org/get", { timeout: 5000 })
      return response.status === 200
    } catch (error) {
      return false
    }
  }

  private calculateJitter(samples: number[]): number {
    if (samples.length < 2) return 0

    let totalJitter = 0
    for (let i = 1; i < samples.length; i++) {
      totalJitter += Math.abs(samples[i] - samples[i - 1])
    }

    return totalJitter / (samples.length - 1)
  }

  getConnectionMetrics(): ConnectionMetrics | null {
    return this.currentConnection?.metrics || null
  }

  startKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
    }

    logger.debug("Starting quantum keep-alive pings every 60 seconds")

    this.keepAliveInterval = setInterval(async () => {
      if (this.currentConnection) {
        // Skip ping if we got 429 error recently (wait at least 60 seconds)
        const timeSince429 = Date.now() - this.last429Error
        if (timeSince429 < 60000) {
          logger.debug(
            `Skipping keep-alive ping - 429 cooldown (${Math.round((60000 - timeSince429) / 1000)}s remaining)`,
          )
          return
        }

        try {
          await this.performAggressiveKeepAlivePing()
        } catch (error) {
          // Silent keep-alive failure
        }
      }
    }, 60000) // Reduced frequency to 60 seconds
  }

  stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
      logger.info("Stopped quantum keep-alive pings")
    }
  }

  private async performAggressiveKeepAlivePing(): Promise<"healthy" | "tcp_lost" | "http_failed"> {
    if (!this.currentConnection) return "healthy"

    try {
      // Only test TCP connectivity to reduce HTTP requests (avoid 429)
      const tcpConnected = await this.testTcpConnectivity()
      if (!tcpConnected) {
        return "tcp_lost"
      }

      return "healthy"
    } catch (error) {
      return "http_failed"
    }
  }

  private async testTcpConnectivity(): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = 1500

      const socket = net.createConnection({
        host: this.currentConnection!.proxy.host,
        port: this.currentConnection!.proxy.port,
      })

      const timer = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, timeout)

      socket.on("connect", () => {
        clearTimeout(timer)
        socket.end()
        resolve(true)
      })

      socket.on("error", () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  private async testHttpConnectivity(): Promise<boolean> {
    try {
      const instance = this.currentConnection!.axiosInstance
      const response = await instance.get("http://httpbin.org/get", {
        timeout: 3000,
        validateStatus: (status: number) => status < 400,
      })

      return response.status < 400
    } catch (error) {
      return false
    }
  }

  async cleanup(): Promise<void> {
    // Stop AI adaptive rotation
    if (this.adaptiveRotationInterval) {
      clearInterval(this.adaptiveRotationInterval)
      this.adaptiveRotationInterval = null
    }

    // Clear AI intelligence data
    this.proxyIntelligence.clear()
    this.requestHistory = []

    this.dnsCache.clear()
    this.connections.clear()
    this.currentConnection = null

    logger.debug("Quantum proxy manager cleaned up (AI intelligence cleared)")
  }
}

export default QuantumProxyManager
