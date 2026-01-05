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
 * Handles browser automation, email verification, and account creation
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
        verbose: this.config.debugMode
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

  private async detectBrowserExecutable(): Promise<string | undefined> {
    const { execSync } = require('child_process')

    // Common browser executable paths and commands
    const browserPaths = [
      // Termux/Android paths
      '/data/data/com.termux/files/usr/bin/chromium',
      '/data/data/com.termux/files/usr/bin/chromium-browser',
      '/data/data/com.termux/files/usr/bin/google-chrome',

      // Linux paths
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/chrome',
      '/usr/bin/firefox',

      // macOS paths
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Firefox.app/Contents/MacOS/firefox',

      // Windows paths
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Chromium\\Application\\chromium.exe',
    ]

    // Try to find browser using which command first (Unix-like systems)
    const whichCommands = ['chromium', 'chromium-browser', 'google-chrome', 'chrome', 'firefox']
    for (const cmd of whichCommands) {
      try {
        const path = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf8' }).trim()
        if (path) {
          logger.debug(`Found browser via which: ${path}`)
          return path
        }
      } catch (e) {
        // Continue to next command
      }
    }

    // Check predefined paths
    for (const path of browserPaths) {
      try {
        require('fs').accessSync(path, require('fs').constants.F_OK)
        logger.debug(`Found browser at: ${path}`)
        return path
      } catch (e) {
        // Path doesn't exist, continue
      }
    }

    logger.warn("No browser executable found, using Puppeteer's default")
    return undefined
  }

  /**
   * Launches a fresh browser instance with proxy configuration
   * Automatically detects browser executable and configures proxy if enabled
   */
  async launchFreshBrowser(): Promise<void> {
    logger.debug("Launching fresh browser instance...")

    // Skip proxy if restarting after proxy failure
    const shouldSkipProxy = this.skipProxyOnRestart
    if (this.skipProxyOnRestart) {
      logger.debug("Skipping proxy setup (restarting after proxy failure)")
      this.currentWorkingProxy = null
      this.skipProxyOnRestart = false // Reset flag
    }

    // Get working proxy BEFORE launching browser
    if (!shouldSkipProxy && this.config.useProxy && this.config.useProxy > 0 && this.proxyManager && !this.currentWorkingProxy) {
      logger.debug("Getting working proxy for browser launch...")
      const workingProxy = await this.proxyManager.getWorkingProxy()
      logger.debug(`getWorkingProxy returned: ${workingProxy ? `${workingProxy.host}:${workingProxy.port} (${workingProxy.protocol})` : 'null'}`)
      if (workingProxy) {
        this.currentWorkingProxy = workingProxy
        logger.debug(`Working proxy stored: ${workingProxy.host}:${workingProxy.port}`)
      } else {
        logger.warn("No working proxy found, proceeding without proxy")
      }
    }

    // Detect browser executable
    const browserExecutable = await this.detectBrowserExecutable()
    if (browserExecutable) {
      logger.debug(`Using browser: ${browserExecutable}`)
    }

    const browserArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-web-security",
      "--disable-features=BlockInsecurePrivateNetworkRequests",
      `--window-size=${this.config.viewportWidth},${this.config.viewportHeight}`,
      `--user-agent=${this.config.userAgent}`,
    ]

    // Set proxy server - use local proxy server for authenticated HTTP proxies
    if (this.currentWorkingProxy) {
      if (this.currentWorkingProxy.username && this.currentWorkingProxy.password && this.currentWorkingProxy.protocol === 'http') {
        // For authenticated HTTP proxies, use local proxy server as workaround
        logger.debug(`Starting local proxy server for authenticated HTTP proxy...`)
        this.localProxyServer = new LocalProxyServer({
          host: this.currentWorkingProxy.host,
          port: this.currentWorkingProxy.port,
          username: this.currentWorkingProxy.username,
          password: this.currentWorkingProxy.password,
          protocol: this.currentWorkingProxy.protocol,
        })
        
        // Listen for proxy ban events - mark proxy as failed
        this.localProxyServer.on('proxy-banned', () => {
          logger.warn(`⚠️  Proxy authentication failed (403) - will retry without proxy`)
          this.currentWorkingProxy = null
        })
        
        // Listen for connection refused events
        this.localProxyServer.on('proxy-connection-refused', () => {
          logger.warn(`⚠️  Proxy connection refused - will retry without proxy`)
          this.currentWorkingProxy = null
        })
        
        const localPort = await this.localProxyServer.start()
        browserArgs.push(`--proxy-server=127.0.0.1:${localPort}`)
        logger.debug(`Using local proxy server on port ${localPort} (forwarding to ${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port})`)
      } else if (this.currentWorkingProxy.protocol === 'socks5' || this.currentWorkingProxy.protocol === 'socks4') {
        // Debug: Check if credentials are parsed
        logger.debug(`SOCKS proxy details: host=${this.currentWorkingProxy.host}, port=${this.currentWorkingProxy.port}, username=${this.currentWorkingProxy.username ? '***' : 'none'}, password=${this.currentWorkingProxy.password ? '***' : 'none'}`)
        
        // For authenticated SOCKS proxies, use local proxy server (similar to HTTP)
        if (this.currentWorkingProxy.username && this.currentWorkingProxy.password) {
          logger.debug(`Starting local SOCKS proxy server for authenticated SOCKS proxy...`)
          this.localProxyServer = new LocalProxyServer({
            host: this.currentWorkingProxy.host,
            port: this.currentWorkingProxy.port,
            username: this.currentWorkingProxy.username,
            password: this.currentWorkingProxy.password,
            protocol: this.currentWorkingProxy.protocol,
          })
          
          // Listen for proxy ban events
          this.localProxyServer.on('proxy-banned', () => {
            logger.warn(`⚠️  SOCKS proxy authentication failed (403) - will retry without proxy`)
            this.currentWorkingProxy = null
          })
          
          // Listen for connection refused events
          this.localProxyServer.on('proxy-connection-refused', () => {
            logger.warn(`⚠️  SOCKS proxy connection refused - will retry without proxy`)
            this.currentWorkingProxy = null
          })
          
          const localPort = await this.localProxyServer.start()
          // Use SOCKS5 format for local proxy (Chrome supports non-authenticated SOCKS5)
          browserArgs.push(`--proxy-server=socks5://127.0.0.1:${localPort}`)
          logger.debug(`Using local SOCKS proxy server on port ${localPort} (forwarding to ${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port})`)
        } else {
          // For non-authenticated SOCKS proxies, use directly
          const proxyServer = `${this.currentWorkingProxy.protocol}://${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port}`
          browserArgs.push(`--proxy-server=${proxyServer}`)
          logger.debug(`Using SOCKS proxy: ${proxyServer}`)
        }
      } else {
        // For non-authenticated HTTP/HTTPS proxies
        // Option: Use local proxy server for better error detection (optional, Chrome can handle directly)
        // For now, use directly - Chrome handles non-authenticated proxies natively
        const proxyServer = `${this.currentWorkingProxy.protocol}://${this.currentWorkingProxy.host}:${this.currentWorkingProxy.port}`
        browserArgs.push(`--proxy-server=${proxyServer}`)
        logger.debug(`Using proxy server: ${proxyServer}`)
        logger.debug(`Note: Non-authenticated HTTP proxies don't need forwarding - Chrome handles them directly`)
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

    // Add executable path if detected (required for puppeteer-core)
    if (browserExecutable) {
      launchOptions.executablePath = browserExecutable
    }

    this.browser = await puppeteer.launch(launchOptions)

    this.page = await this.browser.newPage()

    await this.page.setBypassCSP(true)

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      })
      ;(window as any).chrome = { runtime: {} }
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      })
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      })
    })

    this.page.on("dialog", async (dialog) => {
      const message = dialog.message()
      logger.debug(`JavaScript dialog detected: ${message}`)
      
      // Check if this is the "pass the flame" dialog (last dialog)
      // Exact message: "Confirm Passing the Flame with the player who shared this link? (You can only pass the flame with one player.)"
      const isFlameDialog = message.includes("Confirm Passing the Flame") || 
                            message.includes("Passing the Flame") ||
                            message.toLowerCase().includes("pass the flame") ||
                            message.toLowerCase().includes("passing the flame")
      
      if (isFlameDialog) {
        // Log immediately when detected (before accepting)
        logger.super("✅ Success: Invitation Accepted")
        logger.debug("Flame dialog detected - account creation successful!")
      }
      
      await dialog.accept()
      logger.debug("Dialog accepted")
    })

    // Initialize secure connection manager for ALL connections (direct or proxy)
    if (this.config.enableSecureConnection) {
    this.secureConnectionManager = new SecureConnectionManager({
      enableCertificatePinning: true,
      enableClientCertificates: this.config.enableClientCertificates,
      allowedNetworks: this.config.allowedNetworks,
      blockedNetworks: this.config.blockedNetworks,
      tlsFingerprintCheck: true,
      maxTlsVersion: "TLSv1.3",
      minTlsVersion: "TLSv1.2"
    })

      logger.debug("🔐 Secure connection manager initialized for all connections")
    } else {
      logger.debug("ℹ️  Secure connection manager disabled")
    }

    // Perform security audit for direct connections (no proxy)
    if (this.config.useProxy === 0 && this.config.enableSecureConnection) {
      this.performDirectConnectionSecurityAudit()
    }

    // Initialize quantum proxy manager for conservative proxy usage (only when proxy is enabled)
    // Skip for residential proxies as they handle their own rotation and security
    if (this.config.useProxy > 0 && this.proxyManager) {
      const currentProxy = this.proxyManager.getCurrentProxy()
      if (currentProxy && !currentProxy.host.includes('scrapeops') && !currentProxy.host.includes('residential-proxy')) {
        this.quantumProxyManager = new QuantumProxyManager('act.playcfl.com')

        // Configure security features
        if (this.config.enableClientCertificates &&
            this.config.privateKeyPath &&
            this.config.certificatePath) {
          this.quantumProxyManager.configureClientCertificates(
            this.config.privateKeyPath,
            this.config.certificatePath,
            this.config.caCertificatePath
          )
        }

        // Configure network access controls
        this.quantumProxyManager.configureNetworkAccess(
          this.config.allowedNetworks,
          this.config.blockedNetworks
        )

        const quantumConfig = {
          host: currentProxy.host,
          port: currentProxy.port,
          protocol: currentProxy.protocol as 'http' | 'https' | 'socks4' | 'socks5'
        }

        this.quantumProxyManager.initializeQuantumConnection(quantumConfig).then(async (success) => {
          if (success) {
            logger.debug('⚛️  Quantum proxy initialized - proxy conserved for target site only')

            // Start keep-alive pinging to maintain proxy connection
            this.quantumProxyManager!.startKeepAlive()

            // Perform security audit
            try {
              const audit = await this.quantumProxyManager!.performSecurityAudit()
              logger.debug(`🔒 Security Audit: Score ${audit.score}/100 (${audit.riskLevel} risk)`)
              if (audit.vulnerabilities.length > 0) {
                logger.warn(`⚠️  Security issues: ${audit.vulnerabilities.join(', ')}`)
              }
            } catch (auditError) {
              logger.warn(`⚠️  Security audit failed: ${auditError}`)
            }
          } else {
            logger.warn('⚠️  Quantum proxy initialization failed, using standard proxy')
          }
        }).catch(error => {
          logger.warn(`⚠️  Quantum proxy error: ${error}`)
        })
      } else if (currentProxy && (currentProxy.host.includes('scrapeops') || currentProxy.host.includes('residential-proxy'))) {
        logger.debug('ℹ️  Using residential proxy - Quantum proxy manager skipped for compatibility')
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
      // Log the actual error for debugging
      const errorMessage = error?.message || ""
      logger.debug(`Navigation error: ${errorMessage}`)
      
      // Check if error is due to proxy failure
      const isProxyError = errorMessage.includes("ERR_TUNNEL_CONNECTION_FAILED") || 
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
      
      // Check if it's a connection error (proxy doesn't work) vs timeout (proxy might be slow)
      const isConnectionError = errorMessage.includes("ERR_TUNNEL_CONNECTION_FAILED") || 
                               errorMessage.includes("ERR_PROXY_CONNECTION_FAILED") ||
                               errorMessage.includes("ERR_EMPTY_RESPONSE") ||
                               errorMessage.includes("ERR_NO_SUPPORTED_PROXIES") ||
                               errorMessage.includes("ERR_SOCKS_CONNECTION_FAILED") ||
                               errorMessage.includes("ECONNREFUSED")
      
      const isTimeout = errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")
      
      // For timeouts with proxy, might be slow proxy - try retry first before giving up
      if (isTimeout && this.currentWorkingProxy && !isConnectionError) {
        logger.warn(`⚠️  Navigation timeout with proxy (proxy might be slow). Will retry with longer timeout...`)
        // Don't restart yet, let it retry with longer timeout below
      } else if (isConnectionError && this.currentWorkingProxy) {
        logger.warn(`⚠️  Proxy connection failed during initial navigation: ${errorMessage.substring(0, 100)}`)
        if (this.currentWorkingProxy.username && this.currentWorkingProxy.password) {
          logger.warn(`   Authenticated proxy failed - this is expected if proxy credentials are invalid or proxy is blocked`)
        } else {
          logger.warn(`   Non-authenticated proxy failed - proxy is likely dead/unreliable (common with free proxies)`)
          logger.warn(`   Note: Non-authenticated HTTP proxies don't need forwarding - Chrome handles them directly`)
        }
        logger.warn(`   Restarting browser without proxy...`)
        
        // Stop local proxy server if running
        if (this.localProxyServer) {
          await this.localProxyServer.stop()
          this.localProxyServer = null
        }
        
        // Clear proxy and set flag to skip proxy on restart
        this.currentWorkingProxy = null
        this.skipProxyOnRestart = true
        
        // Close current browser
        if (this.browser) {
          try {
            await this.browser.close()
            this.browser = null
            this.page = null
          } catch (e) {
            logger.debug(`Error closing browser: ${e}`)
          }
        }
        
        // Relaunch browser without proxy
        logger.debug("Relaunching browser without proxy configuration...")
        await this.launchFreshBrowser()
        
        // Retry navigation without proxy
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
        // Check if error is due to proxy failure (403/connection refused/empty response/unsupported)
        const errorMessage = retryError?.message || ""
        const isProxyError = errorMessage.includes("ERR_TUNNEL_CONNECTION_FAILED") || 
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
          
          // Stop local proxy server if running
          if (this.localProxyServer) {
            await this.localProxyServer.stop()
            this.localProxyServer = null
          }
          
          // Clear proxy and set flag to skip proxy on restart
          this.currentWorkingProxy = null
          this.skipProxyOnRestart = true
          
          // Close current browser
          if (this.browser) {
            try {
              await this.browser.close()
              this.browser = null
              this.page = null
            } catch (e) {
              logger.debug(`Error closing browser: ${e}`)
            }
          }
          
          // Relaunch browser without proxy
          logger.debug("Relaunching browser without proxy configuration...")
          await this.launchFreshBrowser()
          
          // Retry navigation without proxy
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

      // Handle verification step
      await this.handleVerificationStep()

      // Check for post-registration alerts
      logger.debug("Checking for post-registration alerts...")
      await this.handlePostRegistrationAlerts()

      logger.successForce("Registration process completed")
    } catch (error) {
      logger.error(`Error during registration: ${error}`)
      await this.page.screenshot({ path: "error-screenshot.png", fullPage: true })
      logger.debug("Error screenshot saved as error-screenshot.png")
    }
  }

  async handleVerificationStep(): Promise<void> {
    logger.info("Starting email verification step...")

    if (!this.page) {
      logger.error("No page available for verification step")
      return
    }

    const verificationHandler = new VerificationHandler(this.page, this.proxyManager, this.emailService, this.config)
    const passwordHandler = new PasswordHandler(this.page, this.proxyManager, this.config)

    try {
      // Wait for verification form elements
      try {
        await this.page.waitForSelector(
          'input[placeholder*="Verification code"], input[placeholder*="verification"], #registerForm_account',
          { timeout: this.getProxyAwareTimeout(10000) },
        )
      } catch (e) {
        logger.warn("Verification form elements not found, continuing...")
      }

      // Check if we already have a verification code before clicking Get code button
      logger.debug("Checking for existing verification code...")
      const existingCode = await verificationHandler.checkExistingVerificationCode()
      logger.debug(`Existing code check result: ${existingCode ? `"${existingCode}"` : "none"}`)

      if (existingCode) {
        logger.info(`Verification code already available: "${existingCode}", skipping Get code button click`)
        const codeFilled = await verificationHandler.fillVerificationCode(existingCode)
        if (!codeFilled) return
      } else {
        logger.info("No existing verification code found, clicking Get code button...")
        // No existing code, click the Get code button
        const codeRequested = await verificationHandler.clickGetCodeButton()
        if (!codeRequested) return

        // Stabilization after Get code click
        logger.debug("Stabilizing after Get code click...")
        await delay(4000)

        // Wait for the verification code
        const verificationCode = await verificationHandler.waitForVerificationCode()
        if (!verificationCode) {
          logger.error("Could not retrieve verification code - stopping process")
          return
        }

        const codeFilled = await verificationHandler.fillVerificationCode(verificationCode)
        if (!codeFilled) return
      }

      // Final check that verification elements are still present
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

      // Verification code has already been filled above, proceed to next steps
      logger.info("Verification code filled successfully, proceeding to next steps...")

      await verificationHandler.handleCountrySelection()
      await verificationHandler.handleAgeVerification()
      await verificationHandler.handleAgreementCheckboxes()

      const continueClicked = await passwordHandler.clickContinueButton()
      if (!continueClicked) return

      const passwordPageLoaded = await passwordHandler.waitForPasswordPage()
      if (!passwordPageLoaded) return

      await passwordHandler.fillPasswordFields()

      const doneClicked = await passwordHandler.clickDoneButton()
      if (doneClicked) {
        logger.super("REGISTRATION COMPLETED SUCCESSFULLY!")
        logger.success(`Account created with email: ${this.currentEmail}`)

        logger.debug("Saving account to valid.txt...")
        saveSuccessfulAccount(this.currentEmail, this.sessionPassword)
      }

      await delay(3000)
    } catch (error) {
      logger.error(`Error during verification step: ${error}`)
      await this.page.screenshot({ path: "verification-error.png", fullPage: true })
      logger.debug("Verification error screenshot saved")
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

        // Check if this is the "pass the flame" dialog (last dialog)
        // Exact message: "Confirm Passing the Flame with the player who shared this link? (You can only pass the flame with one player.)"
        const isFlameDialog = message.includes("Confirm Passing the Flame") ||
                              message.includes("Passing the Flame") ||
                              message.toLowerCase().includes("pass the flame") ||
                              message.toLowerCase().includes("passing the flame")

        if (isFlameDialog) {
          flameDialogAccepted = true
          logger.debug("Flame dialog detected - account creation successful!")
          // Log immediately when detected (before accepting)
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

          // Also check if this dialog contains "invitation" or "accepted" even if not flame dialog
          if (!isFlameDialog && (message.toLowerCase().includes("invitation") || message.toLowerCase().includes("accepted"))) {
            logger.super("✅ Success: Invitation Accepted")
          }
        } catch (acceptError) {
          logger.warn("Dialog was already handled or closed")
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
      logger.debug("🔍 Performing direct connection security audit...")

      const targetDomain = "act.playcfl.com"
      const targetPort = 443

      // Establish secure connection and get security metrics
      const securityMetrics = await this.secureConnectionManager!.establishSecureConnection(
        targetDomain,
        targetPort,
        {
          useTls: true,
          timeout: 15000
        }
      )

      // Calculate security score based on metrics
      let securityScore = securityMetrics.securityScore
      const vulnerabilities: string[] = []

      // Check for common security issues
      if (securityScore < 70) {
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

      // Add any existing vulnerabilities from the metrics
      if (securityMetrics.vulnerabilities && securityMetrics.vulnerabilities.length > 0) {
        vulnerabilities.push(...securityMetrics.vulnerabilities)
      }

      // Determine risk level
      let riskLevel: string
      if (securityScore >= 90) riskLevel = "Low"
      else if (securityScore >= 70) riskLevel = "Medium"
      else if (securityScore >= 50) riskLevel = "High"
      else riskLevel = "Critical"

      logger.debug(`🔒 Direct Connection Security Audit: Score ${securityScore}/100 (${riskLevel} risk)`)

      if (vulnerabilities.length > 0) {
        logger.warn(`⚠️  Security issues: ${vulnerabilities.join(', ')}`)
      } else {
        logger.success("✅ No security vulnerabilities detected")
      }

      // Log certificate details if available
      if (securityMetrics.certificateInfo) {
        logger.debug(`📜 SSL Certificate: ${securityMetrics.certificateInfo.subject}`)
        logger.debug(`📅 Expires: ${securityMetrics.certificateInfo.validTo.toDateString()}`)
      }

    } catch (error) {
      logger.warn(`⚠️  Direct connection security audit failed: ${error}`)
    }
  }

  /**
   * Closes browser and cleans up all resources (proxy servers, connections)
   */
  async close(): Promise<void> {
    logger.debug("Starting browser cleanup...")

    try {
      // Clean up quantum proxy manager
      if (this.quantumProxyManager) {
        logger.debug("Stopping quantum proxy manager...")
        this.quantumProxyManager.stopKeepAlive()
        try {
          await Promise.race([
            this.quantumProxyManager.cleanup(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Quantum proxy cleanup timeout')), 5000)
            )
          ])
          logger.debug("Quantum proxy manager cleaned up")
        } catch (proxyError) {
          logger.warn(`Quantum proxy cleanup failed: ${proxyError}`)
        }
      }

      // Clean up local proxy server
      if (this.localProxyServer) {
        logger.debug("Stopping local proxy server...")
        try {
          await Promise.race([
            this.localProxyServer.stop(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Local proxy server stop timeout')), 10000)
            )
          ])
          logger.debug("Local proxy server stopped")
        } catch (proxyError) {
          logger.warn(`Local proxy server stop failed: ${proxyError}`)
        }
      }

      // Note: SecureConnectionManager doesn't have a cleanup method
      // It manages its own lifecycle

      if (this.browser) {
        logger.debug("Closing browser...")
        try {
          await Promise.race([
            this.browser.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Browser close timeout')), 15000) // Increased timeout for proxy
            )
          ])
          logger.debug("Browser closed successfully")
        } catch (browserError) {
          logger.warn(`Browser close failed: ${browserError}`)
          // Force close browser if normal close fails
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
      // Force close browser if normal close fails
      if (this.browser) {
        try {
          this.browser.close()
        } catch (forceError) {
          logger.error(`Force close also failed: ${forceError}`)
        }
      }
    } finally {
      // Ensure all references are cleared to prevent memory leaks
      this.browser = null
      this.page = null

      // Clear proxy-related references
      if (this.proxyManager) {
        // Note: Don't set proxyManager to null as it might be reused
        logger.debug("Proxy manager reference maintained for reuse")
      }

      // Clear email service reference
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
      // Step 1: Create temp email
      logger.info("STEP 1: Creating temporary email for this session...")
      const tempEmail = await this.emailService.createTempEmail()

      if (tempEmail) {
        this.currentEmail = tempEmail.email_addr
        logger.success(`Using fresh email: ${this.currentEmail}`)
      }

      // Step 2: Launch browser
      logger.info("STEP 2: Launching fresh browser instance...")
      await this.launchFreshBrowser()

      // Step 3: Registration
      logger.info("STEP 3: Starting registration process...")
      await this.navigateToReferralPage()
      await this.performRegistration()

      // Use longer delay when using proxy for final verification
      const isUsingProxy = !!this.proxyManager?.getCurrentProxy()
      const finalDelay = isUsingProxy ? 6000 : 3000 // 6s for proxy, 3s for direct
      logger.info(`Keeping browser open for ${finalDelay / 1000}s final verification and JS alerts...${isUsingProxy ? ' (using proxy - extended delay)' : ''}`)
      await delay(finalDelay)
    } catch (error) {
      logger.error(`Bot execution failed: ${error}`)
      if (this.page) {
        try {
          await this.page.screenshot({ path: "fatal-error.png", fullPage: true })
          logger.debug("Fatal error screenshot saved as fatal-error.png")
        } catch (e) {
          logger.warn("Could not save error screenshot")
        }
      }
    } finally {
      await this.close()
      logger.debug("Browser cleanup completed - fresh session ready for next run")

      // Only force exit if not in continuous mode
      // In continuous mode, control returns to main loop for next session
      const isContinuousMode = this.config?.continuousMode || false
      if (!isContinuousMode) {
        // Force exit to ensure process terminates
        // Use longer timeout for proxy connections which may have lingering network activity
        const exitDelay = this.proxyManager?.getCurrentProxy() ? 2000 : 1000
        setTimeout(() => {
          logger.debug("Force exiting process...")
          // Use process.exit(0) for clean exit, don't use SIGTERM as it may not work reliably
          process.exit(0)
        }, exitDelay)
      }
    }
  }
}

export default CrossfireReferralBot
