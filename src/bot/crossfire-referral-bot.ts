/* eslint-disable no-var */
declare var window: any
declare var document: any
declare var navigator: any
/* eslint-enable no-var */

import puppeteer, { type Browser, type Page } from "puppeteer-core"
import type { RegistrationConfig, ProxyInfo } from "../types"
import { logger } from "../utils/logger"
import { delay, saveSuccessfulAccount } from "../utils/helpers"
import { loadConfig } from "../config"
import { EmailService } from "../services/email-service"
import ProxyManager from "../proxy/proxy-manager"
import { QuantumProxyManager } from "../proxy/quantum-proxy-manager"
import { SecureConnectionManager } from "../proxy/secure-connection-manager"
import { RegistrationHandler } from "./handlers/registration-handler"
import { VerificationHandler } from "./handlers/verification-handler"
import { PasswordHandler } from "./handlers/password-handler"
import { LocalProxyServer } from "../proxy/local-proxy-server"

/**
 * CrossfireReferralBot - Main bot class for automated referral registration
 */
export class CrossfireReferralBot {
  private browser: Browser | null = null
  private page: Page | null = null
  private config: ReturnType<typeof loadConfig>
  private currentEmail = ""
  private sessionPassword: string
  private proxyManager: ProxyManager | null = null
  private currentWorkingProxy: any = null
  private localProxyServer: LocalProxyServer | null = null
  private quantumProxyManager: QuantumProxyManager | null = null
  private secureConnectionManager: SecureConnectionManager | null = null
  private emailService: EmailService
  private skipProxyOnRestart: boolean = false

  /**
   * @param registrationConfig - Configuration for registration (email, password, referralCode)
   */
  constructor(registrationConfig: RegistrationConfig) {
    this.config = loadConfig()
    this.currentEmail = registrationConfig.email
    this.sessionPassword = registrationConfig.password
    this.emailService = new EmailService()

    if (this.config.debugMode) {
      logger.debug("=== BOT INITIALIZATION DEBUG ===")
      logger.debug(`Email: ${this.currentEmail}`)
      logger.debug(`Headless: ${this.config.headless}`)
      logger.debug(`Debug Mode: ${this.config.debugMode}`)
      logger.debug(`Continuous Mode: ${this.config.continuousMode}`)
      logger.debug(`Screenshot on Error: ${this.config.screenshotOnError}`)
    }

    logger.debug(`Proxy config check - useProxy: ${this.config.useProxy}, proxyFile: ${this.config.proxyFile}`)
    if (this.config.useProxy && this.config.useProxy > 0) {
      logger.debug(`Initializing proxy manager with type: ${this.config.useProxy}`)
      logger.info(`🔧 Initializing proxy system...`)
      this.proxyManager = new ProxyManager({
        proxyType: this.config.useProxy,
        proxyFile: this.config.proxyFile,
        socks5Urls: this.config.socks5Urls,
        socks4Urls: this.config.socks4Urls,
        testTimeout: this.config.proxyTimeout,
        maxConcurrentTests: this.config.proxyMaxConcurrentTests,
        testCount: this.config.proxyTestCount,
        verbose: this.config.debugMode,
      })
      logger.debug(`Proxy manager initialized, proxy count: ${this.proxyManager.getProxyCount()}`)
      logger.info(`✅ Proxy system initialized with ${this.proxyManager.getProxyCount()} proxies`)
    } else {
      logger.warn(`Proxy not enabled - useProxy: ${this.config.useProxy}`)
    }
  }

  private getProxyAwareTimeout(baseTimeout: number): number {
    if (this.proxyManager?.getCurrentProxy()) {
      return baseTimeout * 2
    }
    return baseTimeout
  }

  private async proxyAwareDelay(baseDelay: number): Promise<void> {
    const adjustedDelay = this.proxyManager?.getCurrentProxy() ? baseDelay * 1.5 : baseDelay
    await delay(adjustedDelay)
  }

  /**
   * Apply anti-detection measures to make browser appear human
   */
  private async applyAntiDetection(): Promise<void> {
    if (!this.page) return

    // Randomize user agent
    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    ]
    await this.page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)])

    // Inject anti-detection scripts
    await this.page.evaluateOnNewDocument(`
      // Hide webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Mock plugins (real browsers have plugins)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ]
      });

      // Mock languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      // Mock chrome runtime
      window.chrome = { runtime: {}, loadTimes: () => ({}) };

      // Randomize canvas fingerprint slightly
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type) {
        if (type === 'image/png') {
          const ctx = this.getContext('2d');
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            for (let i = 0; i < imageData.data.length; i += 4) {
              imageData.data[i] = imageData.data[i] ^ (Math.random() > 0.99 ? 1 : 0);
            }
            ctx.putImageData(imageData, 0, 0);
          }
        }
        return originalToDataURL.apply(this, arguments);
      };

      // Hide automation indicators
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    `)

    logger.debug("🛡️ Anti-detection measures applied")
  }

  private async detectBrowserExecutable(): Promise<string | undefined> {
    const { execSync } = require("child_process")
    const fs = require("fs")

    logger.info("🔍 Searching for browser...")

    const isWindows = process.platform === "win32"

    const browserPaths: Record<string, string[]> = {
      win32: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Chromium\\Application\\chromium.exe",
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      ],
      darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ],
      linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
    }

    const paths = browserPaths[process.platform] || browserPaths.linux

    // Check predefined paths first (fastest)
    for (const browserPath of paths) {
      try {
        fs.accessSync(browserPath, fs.constants.F_OK)
        const browserName = this.getBrowserName(browserPath)
        const version = await this.getBrowserVersion(browserPath)
        const versionInfo = version ? ` v${version}` : ` (version unknown)`
        logger.info(`Found browser: ${browserName}${versionInfo}`)
        return browserPath
      } catch {}
    }

    // On Unix, try 'which' command (silently)
    if (!isWindows) {
      for (const cmd of ["google-chrome", "chromium", "chromium-browser"]) {
        try {
          const path = execSync(`which ${cmd} 2>/dev/null`, {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim()
          if (path) {
            const browserName = this.getBrowserName(path)
            logger.success(`Found browser: ${browserName}`)
            return path
          }
        } catch {}
      }
    }

    logger.warn("No browser found, using Puppeteer's default")
    return undefined
  }

  private getBrowserName(path: string): string {
    const lower = path.toLowerCase()
    if (lower.includes("chrome")) return "Google Chrome"
    if (lower.includes("chromium")) return "Chromium"
    if (lower.includes("firefox")) return "Firefox"
    return "Browser"
  }

  private isAndroid(): boolean {
    // Multiple ways to detect Android/Termux
    return !!(
      process.env.PREFIX?.includes("com.termux") ||
      process.env.ANDROID_DATA ||
      process.platform === "android" ||
      process.env.SHELL?.includes("termux")
    )
  }

  private async getBrowserVersion(path: string): Promise<string | null> {
    const { execSync, spawn } = require("child_process")
    const isAndroid = this.isAndroid()
    const execOpts = { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 2000 }

    // Windows specific
    if (process.platform === "win32" && path.includes("chrome.exe")) {
      try {
        const result = execSync(
          `wmic datafile where name="${path.replace(/\\/g, "\\\\")}" get Version /value 2>nul`,
          execOpts,
        )
        const match = result.match(/Version=(.+)/)
        return match ? match[1].trim().split(".").slice(0, 3).join(".") : null
      } catch {
        return null
      }
    }

    // Unix-like systems (Linux, Android/Termux)
    const extractVersion = (output: string): string | null => {
      const patterns = [
        /(\d+\.\d+\.\d+[\.\d]*)/,
        /version\s+(\d+\.\d+\.\d+)/i,
        /chromium\s+(\d+\.\d+\.\d+)/i,
        /chrome\s+(\d+\.\d+\.\d+)/i,
      ]
      for (const pattern of patterns) {
        const match = output.match(pattern)
        if (match) return match[1]
      }
      return null
    }

    // Try execSync approaches first (fastest)
    const commands = [
      `"${path}" --version 2>/dev/null`,
      `"${path}" -version 2>/dev/null`,
      isAndroid ? `pkg info chromium-browser 2>/dev/null | grep Version` : null,
      isAndroid ? `chromium-browser --version 2>/dev/null` : null,
    ].filter(Boolean)

    for (const cmd of commands) {
      try {
        const result = execSync(cmd, execOpts)
        const version = extractVersion(result)
        if (version) return version
      } catch {}
    }

    // Try spawn approach (better for some environments)
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(path, ["--version"], { stdio: ["ignore", "pipe", "pipe"], timeout: 2000 })
        let data = ""
        child.stdout.on("data", (chunk: Buffer) => (data += chunk))
        child.stderr.on("data", (chunk: Buffer) => (data += chunk))
        child.on("close", (code: number | null) => (code === 0 ? resolve(data) : reject()))
        child.on("error", reject)
      })
      return extractVersion(output)
    } catch {}

    // Final fallback: file-based extraction
    try {
      const result = execSync(`strings "${path}" 2>/dev/null | grep -E "[0-9]+\\.[0-9]+\\.[0-9]+" | head -1`, execOpts)
      return extractVersion(result.trim())
    } catch {}

    return null
  }

  /**
   * Launches a fresh browser instance with proxy configuration
   * Automatically detects browser executable and configures proxy if enabled
   */
  async launchFreshBrowser(): Promise<void> {
    logger.debug("Launching fresh browser instance...")

    const shouldSkipProxy = this.skipProxyOnRestart
    if (this.skipProxyOnRestart) {
      logger.debug("Skipping proxy setup (restarting after proxy failure)")
      this.currentWorkingProxy = null
      this.skipProxyOnRestart = false
    }

    if (
      !shouldSkipProxy &&
      this.config.useProxy &&
      this.config.useProxy > 0 &&
      this.proxyManager &&
      !this.currentWorkingProxy
    ) {
      logger.debug("Getting working proxy for browser launch...")
      const workingProxy = await this.proxyManager.getWorkingProxy()
      logger.debug(
        `getWorkingProxy returned: ${workingProxy ? `${workingProxy.host}:${workingProxy.port} (${workingProxy.protocol})` : "null"}`,
      )
      if (workingProxy) {
        this.currentWorkingProxy = workingProxy
        logger.debug(`Working proxy stored: ${workingProxy.host}:${workingProxy.port}`)
      } else {
        logger.warn("No working proxy found, proceeding without proxy")
      }
    }

    if (this.config.enableSecureConnection || this.config.enableClientCertificates) {
      logger.info(
        `🔐 Security config: enableSecureConnection=${this.config.enableSecureConnection}, enableClientCertificates=${this.config.enableClientCertificates}`,
      )

      if (this.config.enableSecureConnection) {
        try {
          this.secureConnectionManager = new SecureConnectionManager({
            enableCertificatePinning: true,
            enableClientCertificates: this.config.enableClientCertificates,
            allowedNetworks: this.config.allowedNetworks,
            blockedNetworks: this.config.blockedNetworks,
            tlsFingerprintCheck: true,
            maxTlsVersion: "TLSv1.3",
            minTlsVersion: "TLSv1.2",
          })

          logger.success("🔐 Secure connection manager initialized for all connections")
        } catch (error) {
          logger.error(`Failed to initialize secure connection manager: ${error}`)
          this.secureConnectionManager = null
        }
      }
    }

    const browserExecutable = await this.detectBrowserExecutable()

    const browserArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--disable-gpu",
      "--no-first-run",
      "--mute-audio",
      "--disable-infobars",
      "--disable-notifications",
      "--disable-blink-features=AutomationControlled",
    ]

    if (this.currentWorkingProxy) {
      if (
        this.currentWorkingProxy.username &&
        this.currentWorkingProxy.password &&
        this.currentWorkingProxy.protocol === "http"
      ) {
        logger.debug(`Starting local proxy server for authenticated HTTP proxy...`)
        this.localProxyServer = new LocalProxyServer({
          host: this.currentWorkingProxy.host,
          port: this.currentWorkingProxy.port,
          username: this.currentWorkingProxy.username,
          password: this.currentWorkingProxy.password,
          protocol: this.currentWorkingProxy.protocol,
        })

        this.localProxyServer.on("proxy-banned", () => {
          logger.warn(`⚠️  Proxy authentication failed (403) - will retry without proxy`)
          this.currentWorkingProxy = null
        })

        this.localProxyServer.on("proxy-connection-refused", () => {
          logger.warn(`⚠️  Proxy connection refused - will retry without proxy`)
          this.currentWorkingProxy = null
        })

        const localPort = await this.localProxyServer.start()
        browserArgs.push(`--proxy-server=127.0.0.1:${localPort}`)
        logger.debug(
          `Using local proxy server on port ${localPort} (forwarding to ${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port})`,
        )
      } else if (this.currentWorkingProxy.protocol === "socks5" || this.currentWorkingProxy.protocol === "socks4") {
        logger.debug(
          `SOCKS proxy details: host=${this.currentWorkingProxy.host}, port=${this.currentWorkingProxy.port}, username=${this.currentWorkingProxy.username ? "***" : "none"}, password=${this.currentWorkingProxy.password ? "***" : "none"}`,
        )

        if (this.currentWorkingProxy.username && this.currentWorkingProxy.password) {
          logger.debug(`Starting local SOCKS proxy server for authenticated SOCKS proxy...`)
          this.localProxyServer = new LocalProxyServer({
            host: this.currentWorkingProxy.host,
            port: this.currentWorkingProxy.port,
            username: this.currentWorkingProxy.username,
            password: this.currentWorkingProxy.password,
            protocol: this.currentWorkingProxy.protocol,
          })

          this.localProxyServer.on("proxy-banned", () => {
            logger.warn(`⚠️  SOCKS proxy authentication failed (403) - will retry without proxy`)
            this.currentWorkingProxy = null
          })

          this.localProxyServer.on("proxy-connection-refused", () => {
            logger.warn(`⚠️  SOCKS proxy connection refused - will retry without proxy`)
            this.currentWorkingProxy = null
          })

          const localPort = await this.localProxyServer.start()
          browserArgs.push(`--proxy-server=socks5://127.0.0.1:${localPort}`)
          logger.debug(
            `Using local SOCKS proxy server on port ${localPort} (forwarding to ${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port})`,
          )
        } else {
          const proxyServer = `${this.currentWorkingProxy.protocol}://${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port}`
          browserArgs.push(`--proxy-server=${proxyServer}`)
          logger.debug(`Using SOCKS proxy: ${proxyServer}`)
        }
      } else {
        const proxyServer = `${this.currentWorkingProxy.protocol}://${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port}`
        browserArgs.push(`--proxy-server=${proxyServer}`)
        logger.debug(`Using proxy server: ${proxyServer}`)
      }
    }

    const launchOptions: any = {
      headless: this.config.headless,
      args: browserArgs,
      defaultViewport: {
        width: this.config.viewportWidth,
        height: this.config.viewportHeight,
      },
    }

    if (browserExecutable) {
      launchOptions.executablePath = browserExecutable
    }

    if (this.secureConnectionManager) {
      try {
        const secureOptions = this.secureConnectionManager.getPuppeteerLaunchOptions()
        if (secureOptions && secureOptions.args && secureOptions.args.length > 0) {
          launchOptions.args = [...(launchOptions.args || []), ...secureOptions.args]
          logger.debug(`🔐 Applied ${secureOptions.args.length} security arguments to browser launch`)
        } else {
          logger.debug("🔐 No additional security arguments to apply")
        }
      } catch (error) {
        logger.error(`Failed to apply secure connection options: ${error}`)
      }
    } else {
      logger.debug("🔐 Secure connection manager not available for browser launch")
    }

    logger.debug(`🚀 Browser launch: ${launchOptions.args?.length || 0} args, headless=${launchOptions.headless}`)
    if (this.config.useProxy > 0) {
      if (launchOptions.args?.some((arg: string) => arg.includes("proxy-server"))) {
        logger.debug(`✅ Proxy configured in launch args`)
      } else {
        logger.warn(`⚠️  No proxy-server found in launch args`)
      }
    }

    this.browser = await puppeteer.launch(launchOptions)

    this.page = await this.browser.newPage()

    await this.page.setBypassCSP(true)

    // Anti-detection: Randomize fingerprint for each session
    await this.applyAntiDetection()

    this.page.on("dialog", async (dialog) => {
      const message = dialog.message()
      logger.debug(`JavaScript dialog detected: ${message}`)

      const isFlameDialog =
        message.includes("Confirm Passing the Flame") ||
        message.includes("Passing the Flame") ||
        message.toLowerCase().includes("pass the flame") ||
        message.toLowerCase().includes("passing the flame")

      if (isFlameDialog) {
        logger.super("✅ Success: Invitation Accepted")
        logger.debug("Flame dialog detected - account creation successful!")
      }

      await dialog.accept()
      logger.debug("Dialog accepted")
    })

    await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000 + 500))
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 2000 + 1000))

    if (this.config.useProxy === 0 && this.config.enableSecureConnection) {
      this.performDirectConnectionSecurityAudit()
    }

    if (this.config.useProxy > 0 && this.proxyManager) {
      const currentProxy = this.proxyManager.getCurrentProxy()
      if (
        currentProxy &&
        !currentProxy.host.includes("scrapeops") &&
        !currentProxy.host.includes("residential-proxy")
      ) {
        if (this.secureConnectionManager) {
          if (this.config.enableClientCertificates && this.config.privateKeyPath && this.config.certificatePath) {
          }

          this.secureConnectionManager.updateSecurityConfig({
            allowedNetworks: this.config.allowedNetworks,
            blockedNetworks: this.config.blockedNetworks,
          })
        }

        const quantumConfig = {
          host: currentProxy.host,
          port: currentProxy.port,
          protocol: currentProxy.protocol as "http" | "https" | "socks4" | "socks5",
          username: currentProxy.username,
          password: currentProxy.password,
        }

        this.quantumProxyManager = new QuantumProxyManager("act.playcfl.com")

        this.quantumProxyManager
          .initializeQuantumConnection(quantumConfig)
          .then(async (success) => {
            if (success) {
              logger.debug("⚛️  Quantum proxy initialized - proxy conserved for target site only")
              this.quantumProxyManager!.startKeepAlive()
            } else {
              logger.warn("⚠️  Quantum proxy initialization failed, using standard proxy")
            }
          })
          .catch((error) => {
            logger.warn(`⚠️  Quantum proxy error: ${error}`)
          })
      } else if (
        currentProxy &&
        (currentProxy.host.includes("scrapeops") || currentProxy.host.includes("residential-proxy"))
      ) {
        logger.debug("ℹ️  Using residential proxy - Quantum proxy manager skipped for compatibility")
      }
    }

    if (this.config.useProxy && this.config.useProxy > 0 && this.proxyManager) {
      const currentProxy = this.proxyManager.getCurrentProxy() as ProxyInfo | null
      if (currentProxy && currentProxy.username && currentProxy.password) {
        await this.page.authenticate({
          username: currentProxy.username,
          password: currentProxy.password,
        })
        logger.debug("Proxy authentication configured")
      }
    }

    logger.success("Fresh browser launched successfully")
  }

  /**
   * Navigates to the referral page with automatic proxy error recovery
   * @throws Error if navigation fails after all retry attempts
   */
  async navigateToReferralPage(): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized")

    const referralUrl = `${this.config.levelinfBaseUrl}${this.config.referralCode}`
    logger.info(`Navigating to referral page: ${referralUrl}`)

    const navigationTimeout = this.getProxyAwareTimeout(this.config.navigationTimeout)

    try {
      await this.page.goto(referralUrl, {
        waitUntil: "networkidle2",
        timeout: navigationTimeout,
      })
      logger.success("Page loaded successfully")
    } catch (error: any) {
      const errorMessage = error?.message || ""
      logger.debug(`Navigation error: ${errorMessage}`)

      const isProxyError =
        errorMessage.includes("ERR_TUNNEL_CONNECTION_FAILED") ||
        errorMessage.includes("ERR_PROXY_CONNECTION_FAILED") ||
        errorMessage.includes("ERR_EMPTY_RESPONSE") ||
        errorMessage.includes("ERR_NO_SUPPORTED_PROXIES") ||
        errorMessage.includes("ERR_SOCKS_CONNECTION_FAILED") ||
        errorMessage.includes("ERR_PROXY_AUTH_REQUESTED") ||
        errorMessage.includes("ERR_PROXY_CERTIFICATE_INVALID") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("timeout") ||
        errorMessage.includes("403")

      const isConnectionError =
        errorMessage.includes("ERR_TUNNEL_CONNECTION_FAILED") ||
        errorMessage.includes("ERR_PROXY_CONNECTION_FAILED") ||
        errorMessage.includes("ERR_EMPTY_RESPONSE") ||
        errorMessage.includes("ERR_NO_SUPPORTED_PROXIES") ||
        errorMessage.includes("ERR_SOCKS_CONNECTION_FAILED") ||
        errorMessage.includes("ECONNREFUSED")

      const isTimeout = errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")

      if (isTimeout && this.currentWorkingProxy && !isConnectionError) {
        logger.warn(`⚠️  Navigation timeout with proxy (proxy might be slow). Will retry with longer timeout...`)
      } else if (isConnectionError && this.currentWorkingProxy) {
        logger.warn(`⚠️  Proxy connection failed during initial navigation: ${errorMessage.substring(0, 100)}`)
        if (this.currentWorkingProxy.username && this.currentWorkingProxy.password) {
          logger.warn(`   Authenticated proxy failed - credentials may be invalid or proxy is blocked`)
        } else {
          logger.warn(`   Non-authenticated proxy failed - proxy is likely dead/unreliable`)
        }
        logger.warn(`   Restarting browser without proxy...`)

        if (this.localProxyServer) {
          await this.localProxyServer.stop()
          this.localProxyServer = null
        }

        this.currentWorkingProxy = null
        this.skipProxyOnRestart = true

        if (this.browser) {
          try {
            await this.browser.close()
            this.browser = null
            this.page = null
          } catch (e) {
            logger.debug(`Error closing browser: ${e}`)
          }
        }

        logger.debug("Relaunching browser without proxy configuration...")
        await this.launchFreshBrowser()

        try {
          await this.page!.goto(referralUrl, {
            waitUntil: "domcontentloaded",
            timeout: navigationTimeout * 2,
          })
          logger.success("Page loaded successfully without proxy")
          return
        } catch (directError) {
          logger.error("Navigation failed even without proxy")
          throw directError
        }
      }

      logger.warn("Initial navigation timed out, retrying with longer timeout...")

      try {
        await this.page.goto(referralUrl, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeout * 1.5,
        })
        logger.success("Page loaded (DOM ready)")
      } catch (retryError: any) {
        const errorMessage = retryError?.message || ""
        const isProxyError =
          errorMessage.includes("ERR_TUNNEL_CONNECTION_FAILED") ||
          errorMessage.includes("ERR_PROXY_CONNECTION_FAILED") ||
          errorMessage.includes("ERR_EMPTY_RESPONSE") ||
          errorMessage.includes("ERR_NO_SUPPORTED_PROXIES") ||
          errorMessage.includes("ERR_SOCKS_CONNECTION_FAILED") ||
          errorMessage.includes("ECONNREFUSED") ||
          errorMessage.includes("403")

        if (isProxyError && this.currentWorkingProxy) {
          if (errorMessage.includes("ERR_NO_SUPPORTED_PROXIES")) {
            logger.warn(`⚠️  Chrome doesn't support authenticated SOCKS5 proxies. Restarting browser without proxy...`)
          } else {
            logger.warn(`⚠️  Proxy connection failed. Restarting browser without proxy...`)
          }

          if (this.localProxyServer) {
            await this.localProxyServer.stop()
            this.localProxyServer = null
          }

          this.currentWorkingProxy = null
          this.skipProxyOnRestart = true

          if (this.browser) {
            try {
              await this.browser.close()
              this.browser = null
              this.page = null
            } catch (e) {
              logger.debug(`Error closing browser: ${e}`)
            }
          }

          logger.debug("Relaunching browser without proxy configuration...")
          await this.launchFreshBrowser()

          try {
            await this.page!.goto(referralUrl, {
              waitUntil: "domcontentloaded",
              timeout: navigationTimeout * 2,
            })
            logger.success("Page loaded successfully without proxy")
            return
          } catch (directError) {
            logger.error("Navigation failed even without proxy")
            throw directError
          }
        }

        if (this.proxyManager) {
          logger.debug("Attempting proxy recovery...")
          const recovered = await this.performAdvancedProxyRecovery()
          if (recovered) {
            await this.page.goto(referralUrl, {
              waitUntil: "domcontentloaded",
              timeout: navigationTimeout * 2,
            })
          } else {
            throw retryError
          }
        } else {
          logger.error("All navigation attempts failed")
          throw retryError
        }
      }
    }
  }

  private async performAdvancedProxyRecovery(): Promise<boolean> {
    logger.debug("Performing advanced proxy recovery...")
    if (this.proxyManager) {
      await this.proxyManager.switchToNextProxy()
      return true
    }
    return false
  }

  /**
   * Performs the complete registration process:
   * - Fills registration form
   * - Handles email verification
   * - Sets password
   * - Handles post-registration dialogs
   */
  async performRegistration(): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized")

    logger.info("Starting registration process...")
    const registrationHandler = new RegistrationHandler(this.page, this.proxyManager, this.currentEmail, this.config)

    try {
      logger.debug("Waiting for login button to appear...")

      await registrationHandler.findAndClickLoginButton()
      await delay(2000)

      await registrationHandler.fillEmailInput()
      await registrationHandler.fillPasswordInput()

      const submitClicked = await registrationHandler.clickSubmitButton()
      if (!submitClicked) return

      logger.debug("Waiting for registration form to load...")
      await this.proxyAwareDelay(4000)

      // Check for registration form elements
      logger.debug("Checking for registration form elements...")
      try {
        const registerButtonExists = await this.page.$(`.login-goRegister__button`)
        const emailInputExists = await this.page.$(`input[type="email"]`)

        logger.debug(`Register button found: ${!!registerButtonExists}`)
        logger.debug(`Email input found: ${!!emailInputExists}`)

        if (!registerButtonExists || !emailInputExists) {
          logger.debug("Registration form elements not ready, waiting longer...")
          await this.proxyAwareDelay(3000)
        }
      } catch (debugError) {
        logger.warn("Could not check registration form elements")
      }

      await this.proxyAwareDelay(1000)
      await registrationHandler.clickRegisterForFreeButton()

      const formReady = await registrationHandler.waitForRegistrationForm()
      if (!formReady) {
        logger.debug("Attempting proxy recovery due to form loading failure...")
        const recovered = await this.performAdvancedProxyRecovery()
        if (recovered) {
          logger.debug("Proxy recovered, restarting registration process...")
          return await this.performRegistration()
        }
        return
      }

      logger.debug("Filling registration form...")
      await registrationHandler.fillRegistrationEmail()

      logger.debug("Waiting for email validation...")
      await delay(2000)

      const hasEmailError = await this.page.$(".infinite-form-item-has-error #registerForm_account")
      if (hasEmailError) {
        logger.warn("Email validation error still present")
      } else {
        logger.success("Email validation passed")
      }

      logger.debug("Registration form ready, proceeding to verification step...")
      logger.debug("Skipping password fields in first step - will be filled after email verification")

      await registrationHandler.clickRegistrationSubmit()
      await this.handleVerificationStep()
      logger.debug("Checking for post-registration alerts...")
      await this.handlePostRegistrationAlerts()

      logger.successForce("Registration process completed")
    } catch (error) {
      logger.error(`Error during registration: ${error}`)
      if (this.config.screenshotOnError && this.page && !this.page.isClosed()) {
        try {
          await this.page.screenshot({ path: "error-screenshot.png", fullPage: true })
          logger.debug("Error screenshot saved")
        } catch (e: any) {
          logger.debug(`Could not save screenshot: ${e.message}`)
        }
      }
    }
  }

  async handleVerificationStep(): Promise<void> {
    logger.info("Starting email verification step...")

    if (!this.page) {
      logger.error("No page available for verification step")
      return
    }

    if (this.page.isClosed()) {
      logger.success("Page context destroyed - likely due to successful invitation acceptance")
      logger.success("Registration process completed successfully!")
      return
    }

    const verificationHandler = new VerificationHandler(this.page, this.proxyManager, this.emailService, this.config)
    verificationHandler.resetVerificationState()
    const passwordHandler = new PasswordHandler(this.page, this.proxyManager, this.config)

    try {
      logger.debug("Waiting for page transition after form submission...")
      await delay(2000)

      const verificationInputEarly = await this.page.$('input[placeholder*="Verification code"]')
      if (verificationInputEarly) {
        logger.info("Verification page loaded quickly")
      } else {
        try {
          await this.page.waitForSelector(
            'input[placeholder*="Verification code"], input[placeholder*="verification"]',
            { timeout: this.getProxyAwareTimeout(3000) },
          )
        } catch (e) {
          logger.warn("Verification form elements not found after transition, continuing...")
        }
      }

      logger.debug("Checking for existing verification code...")
      const existingCode = await verificationHandler.checkExistingVerificationCode()
      logger.debug(`Existing code check result: ${existingCode ? `"${existingCode}"` : "none"}`)

      if (existingCode) {
        logger.info(`Verification code already available: "${existingCode}", skipping Get code button click`)
        const codeFilled = await verificationHandler.fillVerificationCode(existingCode)
        if (!codeFilled) return
      } else {
        logger.info("No existing verification code found, clicking Get code button...")
        const codeRequested = await verificationHandler.clickGetCodeButton()
        if (!codeRequested) return

        logger.debug("Stabilizing after Get code click...")
        await delay(4000)

        const verificationCode = await verificationHandler.waitForVerificationCode()
        if (!verificationCode) {
          logger.error("Could not retrieve verification code - stopping process")
          return
        }

        const codeFilled = await verificationHandler.fillVerificationCode(verificationCode)
        if (!codeFilled) return
      }

      const verificationInput = await this.page.waitForSelector('input[placeholder*="Verification code"]', {
        timeout: this.getProxyAwareTimeout(5000),
      })
      const passwordField = await this.page.$('input[placeholder*="New password"], #registerForm_newPassword')

      if (!verificationInput) {
        logger.error("Verification page lost after Get code click - stopping process")
        return
      }

      if (passwordField) {
        logger.warn("Password fields appeared prematurely - page may have auto-transitioned")
        logger.debug("Attempting to return to verification step...")

        await this.page.evaluate(() => {
          const verificationInput = document.querySelector('input[placeholder*="Verification code"]')
          if (verificationInput) {
            verificationInput.scrollIntoView({ behavior: "smooth", block: "center" })
            ;(verificationInput as any).focus()
          }
        })

        await delay(2000)
      }

      logger.info("Verification code filled successfully, proceeding to next steps...")

      await verificationHandler.handleCountrySelection()
      await verificationHandler.handleAgeVerification()
      await verificationHandler.handleAgreementCheckboxes()

      if (this.currentWorkingProxy) {
        logger.debug(
          `Current proxy before continue: ${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port} (${this.currentWorkingProxy.protocol})`,
        )
      } else {
        logger.debug("No proxy currently active before continue")
      }

      const continueClicked = await passwordHandler.clickContinueButton()
      if (!continueClicked) return

      const passwordPageLoaded = await passwordHandler.waitForPasswordPage()
      if (!passwordPageLoaded) return

      await passwordHandler.fillPasswordFields()

      let doneClicked = false
      let retryCount = 0
      const maxRetries = 2

      while (!doneClicked && retryCount <= maxRetries) {
        if (retryCount > 0) {
          logger.info(`Retrying Done button click (attempt ${retryCount + 1}/${maxRetries + 1})`)
          await delay(2000)
        }

        doneClicked = await passwordHandler.clickDoneButton()
        retryCount++

        if (doneClicked) {
          logger.super("REGISTRATION COMPLETED SUCCESSFULLY!")
          logger.success(`Account created with email: ${this.currentEmail}`)
          break
        }

        if (!doneClicked && retryCount <= maxRetries) {
          logger.warn(`Done button click failed (attempt ${retryCount}), will retry...`)
        }
      }

      if (doneClicked) {
        logger.debug("Waiting for page transition after Done button click...")
        await delay(3000)

        const stillOnPasswordPage = await this.page!.$('input[type="password"]')
        if (stillOnPasswordPage) {
          logger.debug("Page did not transition after Done button click - will check invitation dialog")
        }
      } else {
        logger.error(`Done button click failed after ${maxRetries + 1} attempts`)
      }

      const checkRegistrationSuccess = async () => {
        try {
          if (!this.page || this.page.isClosed()) {
            logger.debug("Page context destroyed during navigation - assuming success")
            return true
          }

          const currentUrl = this.page.url()
          const successIndicators = [
            currentUrl.includes("success"),
            currentUrl.includes("complete"),
            currentUrl.includes("dashboard"),
            currentUrl.includes("account"),
            currentUrl.includes("profile"),
          ]

          const successDialog = await this.page.$('[class*="success"], [class*="complete"], [class*="welcome"]')
          const successMessage = await this.page.$(
            'text:contains("success"), text:contains("complete"), text:contains("welcome")',
          )

          return successIndicators.some((indicator) => indicator) || !!successDialog || !!successMessage
        } catch (e) {
          if ((e as any).message && (e as any).message.includes("Execution context was destroyed")) {
            logger.debug("Page context destroyed during navigation - assuming registration success")
            return true
          }
          logger.debug(`Registration success check failed: ${(e as any).message}`)
          return false
        }
      }

      const registrationSuccessful = doneClicked || (await checkRegistrationSuccess())

      if (registrationSuccessful) {
        if (!doneClicked) {
          logger.super("REGISTRATION COMPLETED SUCCESSFULLY!")
          logger.success(`Account created with email: ${this.currentEmail}`)
          logger.info("Registration completed automatically (done button not needed)")
        }

        logger.debug("Saving account to valid.txt...")
        saveSuccessfulAccount(this.currentEmail, this.sessionPassword)
      } else {
        logger.warn("Registration may not have completed successfully")
      }

      await delay(3000)
    } catch (error: any) {
      const errorMsg = error?.message || String(error)

      // Page navigation errors indicate success (registration completed, page redirected)
      if (
        errorMsg.includes("Execution context was destroyed") ||
        errorMsg.includes("Target closed") ||
        errorMsg.includes("Session closed") ||
        errorMsg.includes("frame was detached")
      ) {
        logger.debug("Page navigated during verification - registration likely successful")
        return
      }

      logger.error(`Error during verification step: ${error}`)
    }
  }

  /**
   * Handles post-registration JavaScript dialogs (flame dialog, invitation accepted)
   * @returns true if should close immediately (flame dialog detected), false otherwise
   */
  async handlePostRegistrationAlerts(): Promise<void> {
    logger.debug("Monitoring for post-registration alerts...")

    let flameDialogAccepted = false
    let invitationDialogHandled = false
    let accountSaved = false

    try {
      this.page!.on("dialog", async (dialog) => {
        const message = dialog.message()
        logger.debug(`Post-registration alert detected: "${message}"`)

        const isFlameDialog =
          message.includes("Confirm Passing the Flame") ||
          message.includes("Passing the Flame") ||
          message.toLowerCase().includes("pass the flame") ||
          message.toLowerCase().includes("passing the flame")

        if (isFlameDialog) {
          flameDialogAccepted = true
          logger.debug("Flame dialog detected - account creation successful!")
          logger.super("✅ Success: Invitation Accepted")
        }

        if (message.includes("Invitation accepted") || message.toLowerCase().includes("invitation accepted")) {
          invitationDialogHandled = true
          logger.info("Invitation dialog handled - registration complete!")
        }

        logger.debug("Auto-accepting post-registration alert")

        try {
          await dialog.accept()

          // If this is the flame dialog (last dialog), save account
          if (isFlameDialog) {
            // Save account if not already saved
            if (!accountSaved) {
              accountSaved = true
              saveSuccessfulAccount(this.currentEmail, this.sessionPassword)
            }

            // Log the most important success message (using SUPER for unique/rare logs)
            logger.super("✅ Success: Invitation Accepted")
            logger.info("Registration completed successfully!")
          } else if (flameDialogAccepted && invitationDialogHandled && !accountSaved) {
            accountSaved = true
            logger.debug("Both success dialogs handled - saving account to valid.txt")
            saveSuccessfulAccount(this.currentEmail, this.sessionPassword)
          }

          if (
            !isFlameDialog &&
            (message.toLowerCase().includes("invitation") || message.toLowerCase().includes("accepted"))
          ) {
            logger.super("✅ Success: Invitation Accepted")
          }
        } catch (acceptError) {
          logger.debug("Dialog was already handled or closed")
        }

        await delay(2000)
      })

      const alertDelay = this.proxyManager?.getCurrentProxy() ? 15000 : 8000
      logger.debug(`Waiting ${alertDelay / 1000}s for post-registration JS alerts...`)
      await delay(alertDelay)

      logger.debug("Extra wait for any delayed alerts...")
      await delay(5000)

      if (!accountSaved) {
        logger.debug("Checking for successful registration completion...")
        try {
          const currentUrl = this.page!.url()
          if (
            currentUrl.includes("success") ||
            currentUrl.includes("complete") ||
            currentUrl.includes("dashboard") ||
            currentUrl.includes("account")
          ) {
            logger.success("Registration appears successful - saving account to valid.txt")
            saveSuccessfulAccount(this.currentEmail, this.sessionPassword)
            accountSaved = true
          }
        } catch (e) {
          logger.warn("Could not determine registration success from URL")
        }
      }
    } catch (error) {
      logger.debug("No post-registration alerts detected")
    }
  }

  private async performDirectConnectionSecurityAudit(): Promise<void> {
    try {
      logger.debug("🔍 Performing enhanced connection security audit...")

      const targetDomain = "act.playcfl.com"

      // Use enhanced audit that detects connection method
      const auditResult = await this.secureConnectionManager!.performEnhancedSecurityAudit(
        targetDomain,
        this.currentWorkingProxy,
      )

      const { connectionMethod, securityMetrics, adjustedRiskLevel } = auditResult
      const vulnerabilities: string[] = []

      // Check for common security issues
      if (securityMetrics.securityScore < 70) {
        vulnerabilities.push("Low security score detected")
      }

      if (securityMetrics.certificateInfo && !securityMetrics.certificateInfo.isValid) {
        vulnerabilities.push("Invalid SSL certificate")
      }

      if (securityMetrics.certificateInfo && securityMetrics.certificateInfo.daysUntilExpiry < 30) {
        vulnerabilities.push(`Certificate expires soon (${securityMetrics.certificateInfo.daysUntilExpiry} days)`)
      }

      if (securityMetrics.tlsVersion && !securityMetrics.tlsVersion.includes("1.3")) {
        vulnerabilities.push("Not using latest TLS version")
      }

      if (securityMetrics.networkSecurity && securityMetrics.networkSecurity.riskLevel !== "low") {
        vulnerabilities.push(`Network security risk: ${securityMetrics.networkSecurity.riskLevel}`)
      }

      if (securityMetrics.vulnerabilities && securityMetrics.vulnerabilities.length > 0) {
        vulnerabilities.push(...securityMetrics.vulnerabilities)
      }

      // Add connection method info
      const methodEmojis: Record<string, string> = {
        direct: "🏠",
        proxy: "🌐",
        vpn: "🔒",
        unknown: "❓",
      }
      const methodEmoji = methodEmojis[connectionMethod.method] || "❓"

      logger.info(
        `${methodEmoji} Connection Method: ${connectionMethod.method.toUpperCase()} (${connectionMethod.confidence}% confidence)`,
      )
      logger.info(`🔒 Security Audit: Score ${securityMetrics.securityScore}/100 (${adjustedRiskLevel} risk)`)

      if (connectionMethod.details) {
        logger.debug(`📋 Details: ${connectionMethod.details}`)
      }

      if (vulnerabilities.length > 0) {
        logger.warn(`⚠️  Security issues: ${vulnerabilities.join(", ")}`)
      } else {
        logger.success("✅ No security vulnerabilities detected")
      }

      if (securityMetrics.certificateInfo) {
        logger.debug(`📜 SSL Certificate: ${securityMetrics.certificateInfo.subject}`)
        logger.debug(`📅 Expires: ${securityMetrics.certificateInfo.validTo.toDateString()}`)
      }

      // Log additional insights based on connection method
      if (connectionMethod.method === "proxy") {
        logger.info("ℹ️  Proxy detected - security analysis reflects proxy exit node, not local connection")
      } else if (connectionMethod.method === "vpn") {
        logger.info("ℹ️  VPN detected - security analysis reflects VPN exit node, not local connection")
      } else if (connectionMethod.method === "direct") {
        logger.info("ℹ️  Direct connection - security analysis reflects your local network")
      }
    } catch (error) {
      logger.warn(`⚠️  Enhanced connection security audit failed: ${error}`)
    }
  }

  /**
   * Closes browser and cleans up all resources (proxy servers, connections)
   */
  async close(): Promise<void> {
    logger.debug("Starting browser cleanup...")

    try {
      if (this.quantumProxyManager) {
        logger.debug("Stopping quantum proxy manager...")
        this.quantumProxyManager.stopKeepAlive()
        try {
          await Promise.race([
            this.quantumProxyManager.cleanup(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Quantum proxy cleanup timeout")), 5000)),
          ])
          logger.debug("Quantum proxy manager cleaned up")
        } catch (proxyError) {
          logger.warn(`Quantum proxy cleanup failed: ${proxyError}`)
        }
      }

      if (this.localProxyServer) {
        logger.debug("Stopping local proxy server...")
        try {
          await Promise.race([
            this.localProxyServer.stop(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Local proxy server stop timeout")), 10000)),
          ])
          logger.debug("Local proxy server stopped")
        } catch (proxyError) {
          logger.warn(`Local proxy server stop failed: ${proxyError}`)
        }
      }

      if (this.browser) {
        logger.debug("Closing browser...")
        try {
          await Promise.race([
            this.browser.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Browser close timeout")), 15000)),
          ])
          logger.debug("Browser closed successfully")
        } catch (browserError) {
          logger.warn(`Browser close failed: ${browserError}`)
          try {
            this.browser.close()
            logger.debug("Browser force-closed")
          } catch (forceError) {
            logger.error(`Browser force close also failed: ${forceError}`)
          }
        }
      }
    } catch (error) {
      logger.warn(`Error during cleanup: ${error}`)
      if (this.browser) {
        try {
          this.browser.close()
        } catch (forceError) {
          logger.error(`Force close also failed: ${forceError}`)
        }
      }
    } finally {
      this.browser = null
      this.page = null

      if (this.proxyManager) {
        logger.debug("Proxy manager reference maintained for reuse")
      }

      this.currentEmail = ""

      logger.debug("Cleanup completed")
    }
  }

  /**
   * Main execution method - runs the complete bot workflow
   * Creates temp email, launches browser, performs registration, and handles cleanup
   */
  async run(): Promise<void> {
    try {
      logger.info("STEP 1: Creating temporary email for this session...")
      const tempEmail = await this.emailService.createTempEmail()

      if (tempEmail) {
        this.currentEmail = tempEmail.email_addr
        logger.success(`Using fresh email: ${this.currentEmail}`)
      }

      logger.info("STEP 2: Launching fresh browser instance...")
      await this.launchFreshBrowser()

      logger.info("STEP 3: Starting registration process...")
      await this.navigateToReferralPage()
      await this.performRegistration()

      const isUsingProxy = !!this.proxyManager?.getCurrentProxy()
      const finalDelay = isUsingProxy ? 6000 : 3000
      logger.info(
        `Keeping browser open for ${finalDelay / 1000}s final verification and JS alerts...${isUsingProxy ? " (using proxy - extended delay)" : ""}`,
      )
      await delay(finalDelay)
    } catch (error) {
      logger.error(`Bot execution failed: ${error}`)
      if (this.config.screenshotOnError && this.page && !this.page.isClosed()) {
        try {
          await this.page.screenshot({ path: "fatal-error.png", fullPage: true })
          logger.debug("Fatal error screenshot saved")
        } catch (e: any) {
          logger.debug(`Could not save screenshot: ${e.message}`)
        }
      }
    } finally {
      await this.close()
      logger.debug("Browser cleanup completed - fresh session ready for next run")

      const isContinuousMode = this.config?.continuousMode || false
      if (!isContinuousMode) {
        const exitDelay = this.proxyManager?.getCurrentProxy() ? 2000 : 1000
        setTimeout(() => {
          logger.debug("Force exiting process...")
          process.exit(0)
        }, exitDelay)
      }
    }
  }
}

export default CrossfireReferralBot
