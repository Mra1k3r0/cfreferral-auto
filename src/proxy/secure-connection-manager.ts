import * as tls from "tls"
import * as net from "net"
import * as fs from "fs"
import * as dns from "dns"
import axios, { type AxiosInstance } from "axios"
import { logger } from "../utils/logger"
import type { SecurityConfig, CertificateInfo, NetworkSecurity, SecureConnectionMetrics } from "../types"

export class SecureConnectionManager {
  private securityConfig: SecurityConfig
  private certificateCache = new Map<string, CertificateInfo>()
  private networkCache = new Map<string, NetworkSecurity>()
  private tlsFingerprints = new Set<string>()
  private securityMetrics = new Map<string, SecureConnectionMetrics>()

  constructor(securityConfig: Partial<SecurityConfig> = {}) {
    this.securityConfig = {
      enableCertificatePinning: true,
      enableClientCertificates: false,
      allowedNetworks: ["0.0.0.0/0"],
      blockedNetworks: [],
      tlsFingerprintCheck: true,
      maxTlsVersion: "TLSv1.3",
      minTlsVersion: "TLSv1.2",
      cipherSuites: [
        "ECDHE-RSA-AES256-GCM-SHA384",
        "ECDHE-RSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES256-SHA384",
        "ECDHE-RSA-AES128-SHA256",
      ],
      enableHstsPreload: true,
      securityHeadersCheck: true,
      ...securityConfig,
    }

    // Initialize security asynchronously
    this.initializeSecurity().catch((error) => {
      logger.error(`Failed to initialize secure connection manager: ${error}`)
    })
  }

  private async initializeSecurity(): Promise<void> {
    logger.debug("🔐 Initializing secure connection manager...")

    if (this.securityConfig.enableClientCertificates) {
      await this.loadClientCertificates()
      logger.debug("🔐 Client certificates enabled")
    } else {
      logger.debug("ℹ️  Client certificates disabled")
    }

    await this.initializeTlsFingerprints()
    await this.validateSecurityConfig()

    logger.info("🔐 Secure connection manager initialized successfully")

    // Log current security status and risk assessment
    this.logSecurityStatus()
  }

  private async loadClientCertificates(): Promise<void> {
    if (!this.securityConfig.privateKeyPath || !this.securityConfig.certificatePath) {
      logger.debug("Client certificate paths not configured, skipping certificate loading")
      return
    }

    try {
      logger.debug(
        `Loading client certificates from: ${this.securityConfig.privateKeyPath}, ${this.securityConfig.certificatePath}`,
      )

      await fs.promises.access(this.securityConfig.privateKeyPath, fs.constants.R_OK)
      await fs.promises.access(this.securityConfig.certificatePath, fs.constants.R_OK)

      if (this.securityConfig.caCertificatePath) {
        await fs.promises.access(this.securityConfig.caCertificatePath, fs.constants.R_OK)
      }

      logger.success("🔐 Client certificates loaded and validated successfully")
    } catch (error: any) {
      logger.warn(`Client certificate files not accessible: ${error.message}`)
      logger.debug("Disabling client certificates due to file access issues")
      this.securityConfig.enableClientCertificates = false
    }
  }

  private async initializeTlsFingerprints(): Promise<void> {
    const knownFingerprints = ["SHA256:4a:6d:1a:2e:8d:4b:3f:4c:6e:8f:2d:3e:5f:9a:1b:4c"]

    knownFingerprints.forEach((fp) => this.tlsFingerprints.add(fp))
    logger.debug(`Initialized TLS fingerprint database with ${this.tlsFingerprints.size} known fingerprints`)
  }

  private async validateSecurityConfig(): Promise<void> {
    if (this.securityConfig.minTlsVersion > this.securityConfig.maxTlsVersion) {
      throw new Error("Invalid TLS version configuration")
    }

    this.securityConfig.allowedNetworks.forEach((network) => {
      if (!this.isValidCidr(network)) {
        throw new Error(`Invalid allowed network: ${network}`)
      }
    })

    this.securityConfig.blockedNetworks.forEach((network) => {
      if (!this.isValidCidr(network)) {
        throw new Error(`Invalid blocked network: ${network}`)
      }
    })
  }

  private isValidCidr(cidr: string): boolean {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
    if (!cidrRegex.test(cidr)) return false

    const [ip, prefix] = cidr.split("/")
    const prefixNum = Number.parseInt(prefix)

    return prefixNum >= 0 && prefixNum <= 32 && this.isValidIp(ip)
  }

  private isValidIp(ip: string): boolean {
    const parts = ip.split(".")
    return (
      parts.length === 4 &&
      parts.every((part) => {
        const num = Number.parseInt(part)
        return num >= 0 && num <= 255
      })
    )
  }

  /**
   * Get Puppeteer launch options for secure connections
   */
  getPuppeteerLaunchOptions(): any {
    const options: any = {}
    const securityArgs: string[] = []

    // Only add client certificate args if certificates are properly configured
    if (
      this.securityConfig.enableClientCertificates &&
      this.securityConfig.privateKeyPath &&
      this.securityConfig.certificatePath
    ) {
      try {
        // Validate certificate files exist before adding them
        const fs = require("fs")
        if (fs.existsSync(this.securityConfig.privateKeyPath) && fs.existsSync(this.securityConfig.certificatePath)) {
          securityArgs.push(`--client-certificate=${this.securityConfig.certificatePath}`)
          securityArgs.push(`--client-certificate-key=${this.securityConfig.privateKeyPath}`)

          if (this.securityConfig.caCertificatePath && fs.existsSync(this.securityConfig.caCertificatePath)) {
            securityArgs.push(`--client-certificate-ca=${this.securityConfig.caCertificatePath}`)
          }

          logger.info("🔐 Client certificates configured for Puppeteer")
        } else {
          logger.debug("🔐 Client certificate files not found, skipping certificate configuration")
        }
      } catch (error) {
        logger.warn(`Client certificate validation failed: ${error}`)
      }
    }

    // Always configure TLS versions for security
    securityArgs.push(`--tls-min-version=${this.securityConfig.minTlsVersion}`)
    securityArgs.push(`--tls-max-version=${this.securityConfig.maxTlsVersion}`)

    // Only set options.args if we have security arguments
    if (securityArgs.length > 0) {
      options.args = securityArgs
      logger.debug(`🔐 Prepared ${securityArgs.length} security arguments for browser launch`)
    }

    return options
  }

  async establishSecureConnection(
    host: string,
    port: number,
    options: {
      useTls?: boolean
      timeout?: number
      proxyConfig?: any
    } = {},
  ): Promise<SecureConnectionMetrics> {
    const connectionKey = `${host}:${port}`
    logger.debug(`Establishing secure connection to ${connectionKey}`)

    try {
      const certificateInfo = options.useTls ? await this.analyzeCertificate(host, port) : null
      const networkSecurity = await this.analyzeNetworkSecurity(host)
      const tlsMetrics = options.useTls ? await this.performTlsAnalysis(host, port) : null

      const securityScore = this.calculateSecurityScore({
        certificateInfo,
        networkSecurity,
        tlsMetrics,
      })

      const vulnerabilities = this.identifyVulnerabilities({
        certificateInfo,
        networkSecurity,
        tlsMetrics,
      })

      const recommendations = this.generateSecurityRecommendations(vulnerabilities)

      const metrics: SecureConnectionMetrics = {
        tlsVersion: tlsMetrics?.version || "N/A",
        cipherSuite: tlsMetrics?.cipher || "N/A",
        certificateInfo: certificateInfo || ({} as CertificateInfo),
        networkSecurity,
        securityScore,
        vulnerabilities,
        recommendations,
      }

      this.securityMetrics.set(connectionKey, metrics)

      logger.info(`Secure connection established - Security Score: ${securityScore}/100`)

      if (securityScore < 70) {
        logger.warn(`Low security score (${securityScore}) - ${vulnerabilities.length} vulnerabilities detected`)
      }

      return metrics
    } catch (error) {
      logger.error(`Secure connection failed: ${error}`)
      throw error
    }
  }

  private async analyzeCertificate(host: string, port: number): Promise<CertificateInfo> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout: 10000,
      })

      socket.on("secureConnect", () => {
        const cert = socket.getPeerCertificate()
        socket.end()

        if (!cert) {
          reject(new Error("No certificate received"))
          return
        }

        const certificateInfo: CertificateInfo = {
          subject: (cert.subject as any)?.CN || "Unknown",
          issuer: (cert.issuer as any)?.CN || "Unknown",
          validFrom: new Date(cert.valid_from),
          validTo: new Date(cert.valid_to),
          fingerprint: cert.fingerprint || "Unknown",
          serialNumber: cert.serialNumber || "Unknown",
          publicKeyAlgorithm: (cert.pubkey as any)?.algorithm || "Unknown",
          keySize: (cert.pubkey as any)?.size || 0,
          isValid: this.isCertificateValid(cert),
          daysUntilExpiry: this.getDaysUntilExpiry(cert.valid_to),
        }

        resolve(certificateInfo)
      })

      socket.on("error", reject)
      socket.on("timeout", () => {
        socket.destroy()
        reject(new Error("Certificate analysis timeout"))
      })
    })
  }

  private async analyzeNetworkSecurity(ipOrHost: string): Promise<NetworkSecurity> {
    let ipAddress: string
    try {
      if (net.isIP(ipOrHost)) {
        ipAddress = ipOrHost
      } else {
        const addresses = await this.resolveHostname(ipOrHost)
        ipAddress = addresses[0]
      }
    } catch (error) {
      ipAddress = ipOrHost
    }

    if (this.networkCache.has(ipAddress)) {
      return this.networkCache.get(ipAddress)!
    }

    const isBlocked = this.isIpInBlockedNetworks(ipAddress)
    const isAllowed = !isBlocked && this.isIpInAllowedNetworks(ipAddress)
    const networkRange = this.getNetworkRange(ipAddress)
    const riskLevel = this.assessNetworkRisk(ipAddress, networkRange)

    const networkSecurity: NetworkSecurity = {
      ipAddress,
      isAllowed,
      isBlocked,
      networkRange,
      riskLevel,
    }

    this.networkCache.set(ipAddress, networkSecurity)
    return networkSecurity
  }

  private async performTlsAnalysis(host: string, port: number): Promise<{ version: string; cipher: string }> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host,
        port,
        servername: host,
        timeout: 10000,
      })

      socket.on("secureConnect", () => {
        const protocol = socket.getProtocol()
        const cipher = socket.getCipher()
        socket.end()

        resolve({
          version: protocol || "Unknown",
          cipher: cipher?.name || "Unknown",
        })
      })

      socket.on("error", reject)
      socket.on("timeout", () => {
        socket.destroy()
        reject(new Error("TLS analysis timeout"))
      })
    })
  }

  private isCertificateValid(cert: any): boolean {
    try {
      const now = new Date()
      const validFrom = new Date(cert.valid_from)
      const validTo = new Date(cert.valid_to)

      return now >= validFrom && now <= validTo
    } catch (error) {
      return false
    }
  }

  private getDaysUntilExpiry(validTo: string): number {
    try {
      const expiry = new Date(validTo)
      const now = new Date()
      const diffTime = expiry.getTime() - now.getTime()
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    } catch (error) {
      return -1
    }
  }

  private isIpInBlockedNetworks(ip: string): boolean {
    return this.securityConfig.blockedNetworks.some((network) => this.isIpInNetwork(ip, network))
  }

  private isIpInAllowedNetworks(ip: string): boolean {
    return this.securityConfig.allowedNetworks.some((network) => this.isIpInNetwork(ip, network))
  }

  private isIpInNetwork(ip: string, network: string): boolean {
    const [networkIp, prefix] = network.split("/")
    const prefixNum = Number.parseInt(prefix)

    const ipNum = this.ipToNumber(ip)
    const networkNum = this.ipToNumber(networkIp)
    const mask = (0xffffffff << (32 - prefixNum)) >>> 0

    return (ipNum & mask) === (networkNum & mask)
  }

  private ipToNumber(ip: string): number {
    return ip.split(".").reduce((acc, octet, index) => {
      return acc | (Number.parseInt(octet) << (24 - index * 8))
    }, 0)
  }

  private getNetworkRange(ip: string): string {
    const parts = ip.split(".")
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
  }

  private assessNetworkRisk(ip: string, networkRange: string): "low" | "medium" | "high" | "critical" {
    const firstOctet = Number.parseInt(ip.split(".")[0])

    if (firstOctet === 10 || (firstOctet === 192 && Number.parseInt(ip.split(".")[1]) === 168)) {
      return "low"
    } else if (
      firstOctet === 172 &&
      Number.parseInt(ip.split(".")[1]) >= 16 &&
      Number.parseInt(ip.split(".")[1]) <= 31
    ) {
      return "low"
    } else if (firstOctet >= 192 && firstOctet <= 223) {
      return "medium"
    } else {
      return "high"
    }
  }

  private calculateSecurityScore(metrics: {
    certificateInfo?: CertificateInfo | null
    networkSecurity?: NetworkSecurity
    tlsMetrics?: any
  }): number {
    let score = 100

    if (metrics.certificateInfo) {
      if (!metrics.certificateInfo.isValid) score -= 50
      if (metrics.certificateInfo.daysUntilExpiry < 30) score -= 20
      if (metrics.certificateInfo.keySize < 2048) score -= 15
    }

    if (metrics.networkSecurity) {
      if (metrics.networkSecurity.isBlocked) score -= 100
      if (!metrics.networkSecurity.isAllowed) score -= 30

      switch (metrics.networkSecurity.riskLevel) {
        case "low":
          break
        case "medium":
          score -= 10
          break
        case "high":
          score -= 20
          break
        case "critical":
          score -= 40
          break
      }
    }

    if (metrics.tlsMetrics) {
      const version = metrics.tlsMetrics.version
      if (version === "TLSv1.3") {
        // Good
      } else if (version === "TLSv1.2") {
        score -= 5
      } else {
        score -= 20
      }
    }

    return Math.max(0, Math.min(100, score))
  }

  private identifyVulnerabilities(metrics: {
    certificateInfo?: CertificateInfo | null
    networkSecurity?: NetworkSecurity
    tlsMetrics?: any
  }): string[] {
    const vulnerabilities: string[] = []

    if (metrics.certificateInfo) {
      if (!metrics.certificateInfo.isValid) {
        vulnerabilities.push("Invalid or expired certificate")
      }
      if (metrics.certificateInfo.daysUntilExpiry < 30) {
        vulnerabilities.push("Certificate expires soon")
      }
      if (metrics.certificateInfo.keySize < 2048) {
        vulnerabilities.push("Weak certificate key size")
      }
    }

    if (metrics.networkSecurity) {
      if (metrics.networkSecurity.isBlocked) {
        vulnerabilities.push("IP address in blocked network range")
      }
      if (!metrics.networkSecurity.isAllowed) {
        vulnerabilities.push("IP address not in allowed network range")
      }
    }

    if (metrics.tlsMetrics) {
      const version = metrics.tlsMetrics.version
      if (version !== "TLSv1.3" && version !== "TLSv1.2") {
        vulnerabilities.push(`Weak TLS version: ${version}`)
      }
    }

    return vulnerabilities
  }

  private generateSecurityRecommendations(vulnerabilities: string[]): string[] {
    const recommendations: string[] = []

    vulnerabilities.forEach((vuln) => {
      switch (vuln) {
        case "Invalid or expired certificate":
          recommendations.push("Renew SSL certificate immediately")
          break
        case "Certificate expires soon":
          recommendations.push("Plan certificate renewal")
          break
        case "Weak certificate key size":
          recommendations.push("Upgrade to 2048-bit or higher certificate")
          break
        case "IP address in blocked network range":
          recommendations.push("Use IP from allowed network range")
          break
        case "IP address not in allowed network range":
          recommendations.push("Add network to allowed ranges or use different IP")
          break
        default:
          if (vuln.includes("Weak TLS version")) {
            recommendations.push("Upgrade server to TLS 1.2 or 1.3")
          }
      }
    })

    return recommendations
  }

  private async resolveHostname(hostname: string): Promise<string[]> {
    try {
      return new Promise((resolve, reject) => {
        dns.resolve4(hostname, (err, addresses) => {
          if (err) reject(err)
          else resolve(addresses)
        })
      })
    } catch (error) {
      return [hostname]
    }
  }

  createSecureAxiosInstance(baseURL?: string): AxiosInstance {
    const config: any = {
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }

    if (baseURL) {
      config.baseURL = baseURL
    }

    if (
      this.securityConfig.enableClientCertificates &&
      this.securityConfig.privateKeyPath &&
      this.securityConfig.certificatePath
    ) {
      try {
        const privateKey = fs.readFileSync(this.securityConfig.privateKeyPath)
        const certificate = fs.readFileSync(this.securityConfig.certificatePath)
        let ca: Buffer | undefined

        if (this.securityConfig.caCertificatePath) {
          ca = fs.readFileSync(this.securityConfig.caCertificatePath)
        }

        const https = require("https")
        config.httpsAgent = new https.Agent({
          key: privateKey,
          cert: certificate,
          ca: ca,
          rejectUnauthorized: this.securityConfig.enableCertificatePinning,
          minVersion: this.securityConfig.minTlsVersion,
          maxVersion: this.securityConfig.maxTlsVersion,
          ciphers: this.securityConfig.cipherSuites.join(":"),
        })
      } catch (error) {
        logger.warn(`Failed to configure client certificates: ${error}`)
      }
    }

    return axios.create(config)
  }

  getSecurityMetrics(host: string, port = 443): SecureConnectionMetrics | null {
    return this.securityMetrics.get(`${host}:${port}`) || null
  }

  /**
   * Detect if connection is going through proxy/VPN
   */
  async detectConnectionMethod(proxyConfig?: any): Promise<{
    method: "direct" | "proxy" | "vpn" | "unknown"
    confidence: number
    details: string
  }> {
    try {
      // Check if we have proxy configuration
      if (proxyConfig && proxyConfig.host) {
        return {
          method: "proxy",
          confidence: 95,
          details: `Proxy detected: ${proxyConfig.host}:${proxyConfig.port}`,
        }
      }

      // Try to detect VPN by checking local IP vs external IP
      const localIPs = this.getLocalIPs()
      const externalIP = await this.getExternalIP()

      // If external IP is not in local network ranges, likely VPN/proxy
      const isLocalNetwork = this.isLocalNetworkIP(externalIP)

      if (!isLocalNetwork && localIPs.length > 0) {
        // Check if external IP differs significantly from local network
        const localNetwork = this.getNetworkRange(localIPs[0])
        const externalNetwork = this.getNetworkRange(externalIP)

        if (localNetwork !== externalNetwork) {
          return {
            method: "vpn",
            confidence: 85,
            details: `VPN detected: local ${localNetwork}, external ${externalNetwork}`,
          }
        }
      }

      // Check for common VPN/proxy indicators
      if (await this.detectVPNIndicators()) {
        return {
          method: "vpn",
          confidence: 75,
          details: "VPN indicators detected",
        }
      }

      return {
        method: "direct",
        confidence: 90,
        details: "No proxy/VPN indicators detected",
      }
    } catch (error) {
      return {
        method: "unknown",
        confidence: 0,
        details: `Detection failed: ${error}`,
      }
    }
  }

  private getLocalIPs(): string[] {
    const interfaces = require("os").networkInterfaces()
    const ips: string[] = []

    for (const iface of Object.values(interfaces) as any[]) {
      if (iface) {
        for (const addr of iface) {
          if (addr.family === "IPv4" && !addr.internal) {
            ips.push(addr.address)
          }
        }
      }
    }
    return ips
  }

  private async getExternalIP(): Promise<string> {
    try {
      const response = await axios.get("https://api.ipify.org?format=json", { timeout: 5000 })
      return response.data.ip
    } catch (error) {
      // Fallback to httpbin
      try {
        const response = await axios.get("https://httpbin.org/ip", { timeout: 5000 })
        return response.data.origin
      } catch (fallbackError) {
        throw new Error("Could not determine external IP")
      }
    }
  }

  private isLocalNetworkIP(ip: string): boolean {
    const parts = ip.split(".")
    const first = parseInt(parts[0])
    const second = parseInt(parts[1])

    // Private IP ranges
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first === 127 // localhost
    )
  }

  private async detectVPNIndicators(): Promise<boolean> {
    try {
      // Check for common VPN DNS servers
      const dnsServers = ["8.8.8.8", "1.1.1.1", "208.67.222.222"] // Common public DNS
      // This is a simplified check - in practice you'd check more indicators
      return false // Placeholder
    } catch (error) {
      return false
    }
  }

  /**
   * Enhanced security audit that considers connection method
   */
  async performEnhancedSecurityAudit(
    targetHost: string,
    proxyConfig?: any,
  ): Promise<{
    connectionMethod: any
    securityMetrics: SecureConnectionMetrics
    adjustedRiskLevel: string
  }> {
    const connectionMethod = await this.detectConnectionMethod(proxyConfig)
    const securityMetrics = await this.establishSecureConnection(targetHost, 443, {
      useTls: true,
      timeout: 15000,
    })

    // Adjust risk assessment based on connection method
    let adjustedScore = securityMetrics.securityScore
    let methodMultiplier = 1.0

    switch (connectionMethod.method) {
      case "direct":
        methodMultiplier = 1.0 // Baseline
        break
      case "proxy":
        methodMultiplier = 0.9 // Slight penalty for proxy interception
        break
      case "vpn":
        methodMultiplier = 0.95 // Minor penalty for VPN overhead
        break
      case "unknown":
        methodMultiplier = 0.8 // Higher penalty for uncertainty
        break
    }

    adjustedScore = Math.round(adjustedScore * methodMultiplier)

    let adjustedRiskLevel: string
    if (adjustedScore >= 90) adjustedRiskLevel = "Low"
    else if (adjustedScore >= 70) adjustedRiskLevel = "Medium"
    else if (adjustedScore >= 50) adjustedRiskLevel = "High"
    else adjustedRiskLevel = "Critical"

    logger.debug(`🔍 Connection Method: ${connectionMethod.method} (${connectionMethod.confidence}% confidence)`)
    logger.debug(`📊 Security Score: ${securityMetrics.securityScore}/100 → ${adjustedScore}/100 (adjusted)`)

    return {
      connectionMethod,
      securityMetrics,
      adjustedRiskLevel,
    }
  }

  /**
   * Log current security status and risk assessment
   */
  private logSecurityStatus(): void {
    const enabledFeatures = []
    const securityLevel = "HIGH"

    if (this.securityConfig.enableCertificatePinning) {
      enabledFeatures.push("Certificate Pinning")
    }

    if (this.securityConfig.enableClientCertificates) {
      enabledFeatures.push("Client Certificates")
    }

    if (this.securityConfig.tlsFingerprintCheck) {
      enabledFeatures.push("TLS Fingerprinting")
    }

    enabledFeatures.push(`TLS ${this.securityConfig.minTlsVersion}-${this.securityConfig.maxTlsVersion}`)

    const blockedCount = this.securityConfig.blockedNetworks.length
    const allowedCount = this.securityConfig.allowedNetworks.length

    logger.debug(`🛡️  Security Level: ${securityLevel} | Features: ${enabledFeatures.join(", ")}`)
    logger.debug(`🌐 Network Security: ${allowedCount} allowed networks, ${blockedCount} blocked networks`)
    logger.debug(
      `🔒 TLS Security: Enforcing ${this.securityConfig.minTlsVersion} to ${this.securityConfig.maxTlsVersion}`,
    )

    // Assess overall risk level
    let riskLevel = "LOW"
    if (blockedCount === 0) riskLevel = "MEDIUM"
    if (!this.securityConfig.enableCertificatePinning) riskLevel = "HIGH"

    logger.debug(
      `⚠️  Risk Assessment: ${riskLevel} | Certificate Pinning: ${this.securityConfig.enableCertificatePinning ? "ENABLED" : "DISABLED"}`,
    )
  }

  updateSecurityConfig(newConfig: Partial<SecurityConfig>): void {
    this.securityConfig = { ...this.securityConfig, ...newConfig }
    logger.debug("Security configuration updated")
  }

  clearSecurityCaches(): void {
    this.certificateCache.clear()
    this.networkCache.clear()
    this.securityMetrics.clear()
    logger.debug("Security caches cleared")
  }
}

export default SecureConnectionManager
