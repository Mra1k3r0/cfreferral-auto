/**
 * Default configuration values for Crossfire Legends Referral Bot
 * Edit this file to customize bot settings
 */

import type { Config } from "./index"

export const defaultConfig: Config = {
  /** EMAIL AND PASSWORD */
  levelinfEmail: "your-email@levelinf.com", // <= Or set LEVELINF_EMAIL in .env
  levelinfPassword: "TempPass123!", // <= Or set LEVELINF_PASSWORD in .env

  /** PROXY SETTINGS */
  useProxy: 0, // <= 0=No proxy, 1=HTTP file, 2=HTTPS file, 3=SOCKS4, 4=SOCKS5, 5=Stable mode
  proxyFile: "proxy.txt",

  /** SOCKS PROXY SOURCES */
  socks5Urls: ["https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt"],
  socks4Urls: ["https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt"],

  /** PROXY MANAGER SETTINGS */
  proxyTestCount: 10, // <= Reduced to avoid rate limits
  proxyTimeout: 15000,
  proxyMaxConcurrentTests: 5, // <= Reduced to avoid rate limits
  proxyKeepAliveEnabled: false, // <= Disable to avoid 429 errors
  proxyKeepAliveInterval: 120000, // <= 2 minutes if enabled
  proxyKeepAliveUrls: ["https://1.1.1.1"],

  /** SECURITY CONFIGURATION */
  enableClientCertificates: false, // <= Enable client certificate authentication
  enableSecureConnection: false, // <= Enable secure connection manager
  privateKeyPath: undefined, // <= Path to client private key (.pem/.key)
  certificatePath: undefined, // <= Path to client certificate (.pem/.crt)
  caCertificatePath: undefined, // <= Path to CA certificate (.pem/.crt)
  allowedNetworks: ["0.0.0.0/0"], // <= Networks allowed for connections
  blockedNetworks: [], // <= CIDR notation only (e.g., "192.168.0.0/24")

  /** COUNTRY SELECTION CONFIGURATION */
  disableCountryDropdown: true, // <= Skip country dropdown if already selected

  /** AGREEMENT CHECKBOXES CONFIGURATION */
  enableAgeConfirmation: true, // <= Check adult age confirmation checkbox

  /** LOGGER CONFIGURATION */
  logLevel: 2, // <= INFO level
  enableFileLogging: true,
  logFilePath: "logs/cfreferral.log",
  enableLogColors: true,

  /** BROWSER SETTINGS */
  viewportWidth: 1280,
  viewportHeight: 720,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",

  /** TIMING SETTINGS (IN MILLISECONDS) */
  pageLoadTimeout: 90000,
  elementWaitTimeout: 45000,
  actionDelay: 1500,

  /** EMAIL VERIFICATION SETTINGS */
  maxEmailCheckAttempts: 25,
  emailCheckInterval: 5000,
  smartEmailCheck: true, // <= Fast adaptive timing with clean logging

  /** DEBUG SETTINGS */
  debugMode: false,
  screenshotOnError: true,

  /** BOT SETTINGS */
  headless: false, // <= Set to true for production
  levelinfBaseUrl: "https://act.playcfl.com/act/a20251031rlr/index.html?code=",
  referralCode: "abbqzbq", // <= Or set REFERRAL_CODE in .env
  navigationTimeout: 60000,

  /** CONTINUOUS MODE SETTINGS */
  continuousMode: true, // <= Automatically restart after each successful registration
  maxContinuousSessions: 50, // <= Maximum sessions before stopping (0 = unlimited)
  inactivityTimeout: 300000, // <= Stop if no activity for 5 minutes
}
