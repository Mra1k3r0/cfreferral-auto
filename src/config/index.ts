/**
 * Configuration module for Crossfire Legends Referral Bot
 * Handles environment variables, default settings, and config validation
 */

import { logger } from "../utils/logger"
import * as path from "path"
import * as dotenv from "dotenv"

/**
 * Main configuration interface
 */
export interface Config {
  // Email and password for Levelinf account
  levelinfEmail: string
  levelinfPassword: string

  // Proxy settings
  useProxy: number // 0=no proxy, 1=HTTP file, 2=HTTPS file, 3=SOCKS4, 4=SOCKS5, 5=Stable mode
  proxyFile: string

  // SOCKS proxy sources
  socks5Urls: string[]
  socks4Urls: string[]

  // Proxy manager settings
  proxyTestCount: number
  proxyTimeout: number
  proxyMaxConcurrentTests: number
  proxyKeepAliveEnabled: boolean
  proxyKeepAliveInterval: number
  proxyKeepAliveUrls: string[]

  // Security configuration
  enableClientCertificates: boolean
  enableSecureConnection: boolean
  privateKeyPath?: string
  certificatePath?: string
  caCertificatePath?: string
  allowedNetworks: string[]
  blockedNetworks: string[]

  // Country selection configuration
  disableCountryDropdown: boolean // Set to true to skip country dropdown manipulation if already selected

  // Agreement checkboxes configuration
  enableAgeConfirmation: boolean // Set to true to check the adult age confirmation checkbox

  // Logger configuration
  logLevel: number
  enableFileLogging: boolean
  logFilePath: string
  enableLogColors: boolean

  // Browser settings
  viewportWidth: number
  viewportHeight: number
  userAgent: string

  // Timing settings (in milliseconds)
  pageLoadTimeout: number
  elementWaitTimeout: number
  actionDelay: number

  // Email verification settings
  maxEmailCheckAttempts: number
  emailCheckInterval: number

  // Debug settings
  debugMode: boolean
  screenshotOnError: boolean

  // Bot settings
  headless: boolean
  levelinfBaseUrl: string
  referralCode: string
  navigationTimeout: number

  // Continuous mode settings
  continuousMode: boolean
  maxContinuousSessions: number
  inactivityTimeout: number
}

// Default configuration
export const defaultConfig: Config = {
  // Email and password - set via environment variables or edit here
  levelinfEmail: process.env.LEVELINF_EMAIL || "your-email@levelinf.com",
  levelinfPassword: process.env.LEVELINF_PASSWORD || "TempPass123!",

  // Proxy settings
  useProxy: 0, // 0=no proxy, 1=HTTP file, 2=HTTPS file, 3=SOCKS4, 4=SOCKS5, 5=Stable mode
  proxyFile: "proxy.txt",

  // SOCKS proxy sources
  socks5Urls: ["https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt"],
  socks4Urls: ["https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt"],

  // Proxy manager settings
  proxyTestCount: 35,
  proxyTimeout: 15000,
  proxyMaxConcurrentTests: 20,
  proxyKeepAliveEnabled: true,
  proxyKeepAliveInterval: 10000,
  proxyKeepAliveUrls: [
    "https://8.8.8.8",
    "https://1.1.1.1",
    "https://208.67.222.222",
    "https://8.8.4.4",
    "https://httpbin.org/ip",
  ],

  // Security configuration
  enableClientCertificates: false,
  enableSecureConnection: false,
  allowedNetworks: ["0.0.0.0/0"],
  blockedNetworks: [],

  // Country selection configuration
  disableCountryDropdown: true, // Set to true to skip country dropdown manipulation if already selected

  // Agreement checkboxes configuration
  enableAgeConfirmation: true, // Set to true to check the adult age confirmation checkbox

  // Logger configuration
  logLevel: 2, // INFO level
  enableFileLogging: false,
  logFilePath: "logs/cfreferral.log",
  enableLogColors: true,

  // Browser settings
  viewportWidth: 1280,
  viewportHeight: 720,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",

  // Timing settings (in milliseconds)
  pageLoadTimeout: 90000,
  elementWaitTimeout: 45000,
  actionDelay: 1500,

  // Email verification settings
  maxEmailCheckAttempts: 25,
  emailCheckInterval: 5000,

  // Debug settings
  debugMode: false,
  screenshotOnError: true,

  // Bot settings
  headless: false, // Set to true for production
  levelinfBaseUrl: "https://act.playcfl.com/act/a20251031rlr/index.html?code=",
  referralCode: process.env.REFERRAL_CODE || "abbqzbq",
  navigationTimeout: 60000,

  // Continuous mode settings
  continuousMode: true, // Set to true to automatically restart after each successful registration
  maxContinuousSessions: 50, // Maximum number of sessions before stopping (0 = unlimited)
  inactivityTimeout: 300000, // Stop if no activity for 5 minutes (in milliseconds)
}

// Load configuration with validation
export function loadConfig(): Config {
  // Load environment variables from .env file
  dotenv.config()

  const config = { ...defaultConfig }

  // Resolve file paths from project root
  const projectRoot = path.resolve(__dirname, "../..")

  // Resolve proxy file path from project root
  if (config.proxyFile && !path.isAbsolute(config.proxyFile)) {
    config.proxyFile = path.resolve(projectRoot, config.proxyFile)
    logger.debug(`Resolved proxy file path to: ${config.proxyFile}`)
  }

  // Resolve log file path from project root
  if (config.logFilePath && !path.isAbsolute(config.logFilePath)) {
    config.logFilePath = path.resolve(projectRoot, config.logFilePath)
    logger.debug(`Resolved log file path to: ${config.logFilePath}`)
  }

  // Validate required fields (warnings removed - using temp email by default)
  // Note: Email and password are optional - bot uses temp email if not provided

  // Log proxy status
  const proxyMessages: Record<number, string> = {
    0: "Proxy disabled - using direct connection",
    1: "HTTP proxy enabled - using proxies from file",
    2: "HTTPS proxy enabled - using proxies from file",
    3: "SOCKS4 proxy enabled - fetching from GitHub",
    4: "SOCKS5 proxy enabled - fetching from GitHub",
    5: "STABLE proxy mode - minimal proxy usage for reliability",
  }

  const message = proxyMessages[config.useProxy]
  if (message) {
    logger.debug(message)
  } else {
    logger.warn("Invalid proxy setting, defaulting to STABLE mode")
    config.useProxy = 5
  }

  return config
}
