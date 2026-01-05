/**
 * Logger module - Provides structured logging with multiple log levels
 * Supports colored output, file logging, and custom log levels
 */

import * as fs from "fs"
import * as path from "path"

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  SUCCESS = 3,
  SUPER = 4,
  DEBUG = 5,
}

export interface LoggerConfig {
  level: LogLevel
  enableFileLogging: boolean
  logFilePath: string
  enableColors: boolean
}

export class Logger {
  private config: LoggerConfig
  private timezone = "Asia/Manila"
  private colors = {
    bg: {
      ERROR: "\x1b[41m",
      WARN: "\x1b[43m",
      INFO: "\x1b[44m",
      SUCCESS: "\x1b[42m",
      SUPER: "\x1b[45m", // Magenta background for unique/rare logs
      DEBUG: "\x1b[47m",
    },
    text: {
      ERROR: "\x1b[37m",
      WARN: "\x1b[30m",
      INFO: "\x1b[37m",
      SUCCESS: "\x1b[30m",
      SUPER: "\x1b[37m",
      DEBUG: "\x1b[30m",
    },
    reset: "\x1b[0m",
  }

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO, // Default to INFO level (SUCCESS logs hidden by default)
      enableFileLogging: false,
      logFilePath: "logs/app.log",
      enableColors: true,
      ...config,
    }

    if (this.config.enableFileLogging) {
      const logDir = path.dirname(this.config.logFilePath)
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
    }
  }

  private getTimestamp(): string {
    const now = new Date()
    const manilaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)

    const year = manilaTime.getUTCFullYear()
    const month = String(manilaTime.getUTCMonth() + 1).padStart(2, "0")
    const day = String(manilaTime.getUTCDate()).padStart(2, "0")
    const hours = String(manilaTime.getUTCHours()).padStart(2, "0")
    const minutes = String(manilaTime.getUTCMinutes()).padStart(2, "0")
    const seconds = String(manilaTime.getUTCSeconds()).padStart(2, "0")

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  private formatMessage(level: keyof typeof LogLevel, message: string): string {
    const levelName = level.toLowerCase()
    const timestamp = this.getTimestamp()

    if (!this.config.enableColors) {
      return `[${levelName}] - ${timestamp}: ${message}`
    }

    const bgColor = this.colors.bg[level as keyof typeof this.colors.bg]
    const textColor = this.colors.text[level as keyof typeof this.colors.bg]
    const reset = this.colors.reset

    return `${bgColor}${textColor}[${levelName}]${reset} - ${timestamp}: ${message}`
  }

  /**
   * Checks if a log level should be displayed based on current config
   * SUPER messages are always shown regardless of log level
   * @param level - Log level to check
   */
  private shouldLog(level: LogLevel): boolean {
    if (level === LogLevel.SUPER) {
      return true
    }
    return level <= this.config.level
  }

  private writeLog(level: keyof typeof LogLevel, message: string): void {
    const formattedMessage = this.formatMessage(level, message)

    console.log(formattedMessage)

    if (this.config.enableFileLogging) {
      const plainMessage = this.config.enableColors ? formattedMessage.replace(/\x1b\[[0-9;]*m/g, "") : formattedMessage

      fs.appendFileSync(this.config.logFilePath, plainMessage + "\n")
    }
  }

  error(message: string): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.writeLog("ERROR", message)
    }
  }

  warn(message: string): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.writeLog("WARN", message)
    }
  }

  info(message: string): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.writeLog("INFO", message)
    }
  }

  success(message: string): void {
    if (this.shouldLog(LogLevel.SUCCESS)) {
      this.writeLog("SUCCESS", message)
    }
  }

  /**
   * Forces a success message to display regardless of log level
   * @param message - Success message to display
   */
  successForce(message: string): void {
    this.writeLog("SUCCESS", message)
  }

  super(message: string): void {
    if (this.shouldLog(LogLevel.SUPER)) {
      this.writeLog("SUPER", message)
    }
  }

  debug(message: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.writeLog("DEBUG", message)
    }
  }

  updateConfig(newConfig: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...newConfig }

    if (this.config.enableFileLogging) {
      const logDir = path.dirname(this.config.logFilePath)
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
    }
  }

  getConfig(): LoggerConfig {
    return { ...this.config }
  }
}

// Export singleton instance with default logger
// Will be replaced with configured logger when initializeLogger is called
export let logger = new Logger({
  level: LogLevel.INFO,
  enableFileLogging: false,
  logFilePath: "logs/bot.log",
  enableColors: true
})

export function initializeLogger(config: { debugMode: boolean, enableFileLogging: boolean, logFilePath: string, enableLogColors: boolean }) {
  const logLevel = config.debugMode ? LogLevel.DEBUG : LogLevel.INFO
  logger = new Logger({
    level: logLevel,
    enableFileLogging: config.enableFileLogging,
    logFilePath: config.logFilePath,
    enableColors: config.enableLogColors
  })
}

// Export createLogger function for custom configurations
export function createLogger(config: Partial<LoggerConfig>): Logger {
  return new Logger(config)
}
