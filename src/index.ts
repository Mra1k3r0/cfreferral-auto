/**
 * Crossfire Legends Referral Bot
 * 
 * Automated referral registration bot for Crossfire Legends game.
 * Features:
 * - Automatic temporary email generation via GuerrillaMail
 * - Browser automation using Puppeteer Core
 * - Proxy support (HTTP, HTTPS, SOCKS4, SOCKS5)
 * - Automatic account registration and verification
 * - Multi-platform support (Windows, Linux, macOS, Android Termux)
 * 
 * @author mra1k3r0
 * @license MIT
 */

import { CrossfireReferralBot } from "./bot/crossfire-referral-bot"
import { loadConfig } from "./config"
import { initializeLogger, logger } from "./utils/logger"
import { generateSecurePassword } from "./utils/helpers"
import { animatedBanner } from "./utils/banner"
import type { RegistrationConfig } from "./types"

/**
 * Main entry point - initializes and runs the referral bot
 */
async function main() {
  // Display animated application banner
  await animatedBanner()

  const botConfig = loadConfig()

  // Initialize logger with config settings
  initializeLogger({
    debugMode: botConfig.debugMode,
    enableFileLogging: botConfig.enableFileLogging,
    logFilePath: botConfig.logFilePath,
    enableLogColors: botConfig.enableLogColors
  })

  // Show debug info when debugMode is enabled
  if (botConfig.debugMode) {
    logger.debug("=== DEBUG MODE ENABLED ===")
    logger.debug(`Config: continuousMode=${botConfig.continuousMode}, headless=${botConfig.headless}`)
    logger.debug(`Proxy: useProxy=${botConfig.useProxy}, file=${botConfig.proxyFile}`)
    logger.debug(`Timeouts: pageLoad=${botConfig.pageLoadTimeout}ms, elementWait=${botConfig.elementWaitTimeout}ms`)
    logger.debug("==========================")
  }

  if (botConfig.continuousMode) {
    await runContinuousMode(botConfig)
  } else {
    await runSingleSession(botConfig)
  }
}

/**
 * Run bot in single session mode (original behavior)
 */
async function runSingleSession(botConfig: any) {
  const sessionPassword = generateSecurePassword()

  const config: RegistrationConfig = {
    email: botConfig.levelinfEmail,
    password: sessionPassword,
    referralCode: botConfig.referralCode,
  }

  logger.success("Starting Crossfire Referral Automation (Single Session)")
  logger.debug(`Email: ${config.email}`)
  logger.debug(`Password: ${"*".repeat(config.password.length)} (${config.password.length} chars, secure)`)

  const bot = new CrossfireReferralBot(config)
  await bot.run()

  logger.success("Automation completed!")
}

/**
 * Run bot in continuous mode - automatically restart after each successful registration
 */
async function runContinuousMode(botConfig: any) {
  logger.success("Starting Crossfire Referral Automation (Continuous Mode)")
  logger.info(`Max sessions: ${botConfig.maxContinuousSessions === 0 ? 'unlimited' : botConfig.maxContinuousSessions}`)
  logger.info(`Inactivity timeout: ${botConfig.inactivityTimeout / 1000}s`)

  let sessionCount = 0
  let lastActivityTime = Date.now()

  // Handle inactivity timeout
  const inactivityTimer = setInterval(() => {
    const timeSinceActivity = Date.now() - lastActivityTime
    if (timeSinceActivity > botConfig.inactivityTimeout) {
      logger.warn(`Inactivity timeout reached (${botConfig.inactivityTimeout / 1000}s) - stopping continuous mode`)
      clearInterval(inactivityTimer)
      process.exit(0)
    }
  }, 30000) // Check every 30 seconds

  while (true) {
    // Check session limit
    if (botConfig.maxContinuousSessions > 0 && sessionCount >= botConfig.maxContinuousSessions) {
      logger.success(`Reached maximum sessions (${botConfig.maxContinuousSessions}) - stopping continuous mode`)
      break
    }

    sessionCount++
    logger.info(`=== SESSION ${sessionCount} ===`)

    try {
      const sessionPassword = generateSecurePassword()

      const config: RegistrationConfig = {
        email: botConfig.levelinfEmail,
        password: sessionPassword,
        referralCode: botConfig.referralCode,
      }

      logger.debug(`Email: ${config.email}`)
      logger.debug(`Password: ${"*".repeat(config.password.length)} (${config.password.length} chars, secure)`)

      const bot = new CrossfireReferralBot(config)
      await bot.run()

      lastActivityTime = Date.now()
      logger.success(`Session ${sessionCount} completed successfully!`)

      // Brief pause between sessions
      const pauseBetweenSessions = 3000
      logger.info(`Waiting ${pauseBetweenSessions / 1000}s before next session...`)
      await new Promise(resolve => setTimeout(resolve, pauseBetweenSessions))

    } catch (error) {
      logger.error(`Session ${sessionCount} failed: ${error}`)
      lastActivityTime = Date.now()

      // Continue to next session unless it's a critical error
      const pauseAfterError = 5000
      logger.info(`Waiting ${pauseAfterError / 1000}s before retry...`)
      await new Promise(resolve => setTimeout(resolve, pauseAfterError))
    }
  }

  clearInterval(inactivityTimer)
  logger.success(`Continuous mode completed! Total sessions: ${sessionCount}`)
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.debug("Received SIGINT, shutting down gracefully...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  logger.debug("Received SIGTERM, shutting down gracefully...")
  process.exit(0)
})

// Run the bot
main().catch((error) => {
  // Use console.error as fallback in case logger is not initialized
  console.error(`Bot execution failed: ${error}`)
  process.exit(1)
})

export { CrossfireReferralBot } from "./bot/crossfire-referral-bot"
export { ProxyManager } from "./proxy/proxy-manager"
export { QuantumProxyManager } from "./proxy/quantum-proxy-manager"
export { SecureConnectionManager } from "./proxy/secure-connection-manager"
export { EmailService } from "./services/email-service"
export { loadConfig, Config } from "./config"
export { logger, Logger, LogLevel, createLogger } from "./utils/logger"
export * from "./types"
export * from "./utils/helpers"
