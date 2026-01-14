/**
 * RegistrationHandler - Handles registration form filling and submission
 */

/* eslint-disable no-var */
declare var document: any
/* eslint-enable no-var */

import type { Page } from "puppeteer-core"
import { delay } from "../../utils/helpers"
import { logger } from "../../utils/logger"
import type ProxyManager from "../../proxy/proxy-manager"

export class RegistrationHandler {
  private page: Page
  private proxyManager: ProxyManager | null
  private currentEmail: string
  private sessionPassword: string
  private config: any

  constructor(page: Page, proxyManager: ProxyManager | null, currentEmail: string, sessionPassword: string, config: any) {
    this.page = page
    this.proxyManager = proxyManager
    this.currentEmail = currentEmail
    this.sessionPassword = sessionPassword
    this.config = config
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

  async findAndClickLoginButton(): Promise<boolean> {
    const loginButtonTimeout = this.getProxyAwareTimeout(this.config.elementWaitTimeout)
    let loginButtonFound = false
    let retryCount = 0
    const maxRetries = 3

    while (!loginButtonFound && retryCount < maxRetries) {
      try {
        await this.page.waitForSelector('#pop2LoginBtn, .pop_btn3, [data-lang="lang24"]', {
          timeout: loginButtonTimeout / maxRetries,
        })
        loginButtonFound = true
        logger.success("Login button found on page")
      } catch (error) {
        retryCount++
        if (retryCount < maxRetries) {
          logger.warn(`Login button not found (attempt ${retryCount}/${maxRetries}), retrying...`)
          const retryDelay = this.proxyManager?.getCurrentProxy() ? 5000 : 2000
          await delay(retryDelay * retryCount)
        } else {
          logger.error("Login button not found after all retries")
          throw error
        }
      }
    }

    return loginButtonFound
  }

  async fillEmailInput(): Promise<boolean> {
    const emailSelector = "#registerForm_account"

    try {
      const element = await this.page.$(emailSelector)
      if (element) {
        logger.info(`Found email input: ${emailSelector}`)
        await element.type(this.currentEmail, { delay: 100 })
        return true
      }
    } catch (e) {
      logger.debug(`Email selector ${emailSelector} failed: ${e}`)
    }

    logger.debug("Email input not found")
    return false
  }

  async fillPasswordInput(): Promise<boolean> {
    try {
      const element = await this.page.$('input[type="password"]')
      if (element) {
        await element.type(this.sessionPassword, { delay: 100 })
        return true
      }
    } catch (e) {
      logger.debug(`Password input failed: ${e}`)
    }
    return false
  }

  async clickSubmitButton(): Promise<boolean> {
    try {
      const element = await this.page.$("#pop2LoginBtn")
      if (element) {
        await element.click()
        logger.info("Login button clicked, waiting for registration form...")
        await this.proxyAwareDelay(1000)
        return true
      }
    } catch (e) {
      logger.debug(`Login button click failed: ${e}`)
    }

    logger.warn("Login button not found automatically, waiting for manual interaction...")
    return false
  }

  async clickRegisterForFreeButton(): Promise<boolean> {
    try {
      const element = await this.page.$(".login-goRegister__button")
      if (element) {
        await element.click()
        logger.info("Register for free button clicked!")
        return true
      }
    } catch (e) {
      logger.debug(`Register button click failed: ${e}`)
    }

    logger.warn("Register button not found")
    return false
  }

  async waitForRegistrationForm(): Promise<boolean> {
    let formReady = false
    let formWaitAttempts = 0
    const maxFormWaitAttempts = 5

    while (!formReady && formWaitAttempts < maxFormWaitAttempts) {
      try {
        const emailInput = await this.page.$("#registerForm_account")

        if (emailInput) {
          logger.success("Registration form loaded successfully - found email input")
          formReady = true
        } else {
          formWaitAttempts++
          logger.info(
            `Registration form not ready (attempt ${formWaitAttempts}/${maxFormWaitAttempts}), waiting longer...`,
          )

          if (formWaitAttempts < maxFormWaitAttempts) {
            await this.proxyAwareDelay(2000 + formWaitAttempts * 1000)
          }
        }
      } catch (error) {
        formWaitAttempts++
        logger.info(
          `Registration form not ready (attempt ${formWaitAttempts}/${maxFormWaitAttempts}), waiting longer...`,
        )

        if (formWaitAttempts < maxFormWaitAttempts) {
          await this.proxyAwareDelay(2000 + formWaitAttempts * 1000)
        }
      }
    }

    if (!formReady) {
      logger.error("Registration form failed to load after all attempts")
    }

    return formReady
  }

  async fillRegistrationEmail(): Promise<boolean> {
    logger.info("Filling email address...")

    const emailSelector = "#registerForm_account"
    const element = await this.page.$(emailSelector)

    if (element) {
      // Clear field and type email using element methods (more reliable)
      await element.click({ clickCount: 3 }) // Select all
      await element.type("", { delay: 50 }) // Clear
      await this.proxyAwareDelay(100)
      await element.type(this.currentEmail, { delay: 100 }) // Type email

      logger.success(`Email filled: ${this.currentEmail}`)
      return true
    }

    logger.debug("Email input not found")
    return false
  }

  async clickRegistrationSubmit(): Promise<boolean> {
    try {
      const element = await this.page.$('button[type="submit"]')
      if (element) {
        await element.click()
        logger.info("Registration form submitted!")
        await this.proxyAwareDelay(2500)
        return true
      }
    } catch (e) {
      logger.debug(`Registration submit failed: ${e}`)
    }
    return false
  }
}

export default RegistrationHandler
