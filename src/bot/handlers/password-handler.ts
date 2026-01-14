/**
 * PasswordHandler - Handles password creation page interactions
 */

import type { Page } from "puppeteer-core"
import { delay } from "../../utils/helpers"
import { logger, colors } from "../../utils/logger"
import type ProxyManager from "../../proxy/proxy-manager"

/* eslint-disable no-var */
declare var document: any
/* eslint-enable no-var */

export class PasswordHandler {
  private page: Page
  private proxyManager: ProxyManager | null
  private sessionPassword: string
  private config: any

  constructor(page: Page, proxyManager: ProxyManager | null, sessionPassword: string, config: any) {
    this.page = page
    this.proxyManager = proxyManager
    this.sessionPassword = sessionPassword
    this.config = config
  }

  private getProxyAwareTimeout(baseTimeout: number): number {
    if (this.proxyManager?.getCurrentProxy()) {
      return baseTimeout * 2
    }
    return baseTimeout
  }

  /**
   * Find and click a button by its text content
   */
  private async clickButtonByText(targetText: string, skipTexts: string[] = []): Promise<boolean> {
    try {
      const buttonData = await this.page.evaluate(
        (target: string, skip: string[]) => {
          const buttons = Array.from(document.querySelectorAll("button"))
          for (const button of buttons) {
            const btn = button as any
            if (btn.disabled || btn.hasAttribute("disabled")) continue

            const text = btn.textContent?.trim() || ""
            const lowerText = text.toLowerCase()

            if (skip.some((s) => lowerText.includes(s.toLowerCase()))) continue

            if (lowerText.includes(target.toLowerCase())) {
              const rect = btn.getBoundingClientRect()
              if (rect.width > 0 && rect.height > 0) {
                return { text, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
              }
            }
          }
          return null
        },
        targetText,
        skipTexts,
      )

      if (buttonData) {
        await this.page.mouse.click(buttonData.x, buttonData.y)
        logger.success(`${targetText} button clicked: "${buttonData.text}"`)
        return true
      }
    } catch (e) {
      logger.debug(`Could not find ${targetText} button: ${e}`)
    }
    return false
  }

  async clickContinueButton(): Promise<boolean> {
    colors.stepHeader(6, "Proceeding to password creation page")

    const clicked = await this.clickButtonByText("Continue", ["get code", "send code", "resend"])

    if (!clicked) {
      logger.info("Continue button not found, waiting for page transition...")
      await delay(1500)

      const passwordField = await this.page.$('input[type="password"]')
      if (passwordField) {
        logger.info("Page auto-transitioned to password page")
        return true
      }

      await delay(2000)
      const retryClicked = await this.clickButtonByText("Continue", ["get code", "send code", "resend"])
      if (!retryClicked) {
        logger.error("Could not click Continue button")
        return false
      }
    }

    return true
  }

  async waitForPasswordPage(): Promise<boolean> {
    logger.info("Waiting for password creation page to load...")

    const maxWaitTime = this.proxyManager?.getCurrentProxy() ? 5000 : 3000

    for (let waited = 0; waited < maxWaitTime; waited += 500) {
      const field = await this.page.$('input[type="password"]')
      if (field) {
        logger.success("Password creation page loaded")
        return true
      }
      await delay(500)
    }

    logger.error("Password creation page did not load")
    return false
  }

  async fillPasswordFields(): Promise<boolean> {
    logger.info("Filling password fields...")

    try {
      await this.page.waitForSelector('input[type="password"]', {
        timeout: this.getProxyAwareTimeout(5000),
      })
    } catch (e) {
      logger.error("Password form did not load")
      return false
    }

    // Fill new password
    const newPasswordInput =
      (await this.page.$("#registerForm_newPassword")) || (await this.page.$('input[placeholder*="New password"]'))
    if (newPasswordInput) {
      await newPasswordInput.click({ clickCount: 3 })
      await newPasswordInput.type(this.sessionPassword, { delay: 150 })
      logger.success("Filled new password field")
    }

    // Fill confirm password
    const confirmPasswordInput =
      (await this.page.$("#registerForm_confirmPassword")) || (await this.page.$('input[placeholder*="Confirm"]'))
    if (confirmPasswordInput) {
      await confirmPasswordInput.click({ clickCount: 3 })
      await confirmPasswordInput.type(this.sessionPassword, { delay: 150 })
      logger.success("Filled confirm password field")
    }

    const validationDelay = this.proxyManager?.getCurrentProxy() ? 6000 : 4000
    logger.info(`Waiting ${validationDelay / 1000}s for password validation...`)
    await delay(validationDelay)

    return true
  }

  async clickDoneButton(): Promise<boolean> {
    logger.info("Looking for Done button...")

    const clicked = await this.clickButtonByText("Done", ["get code", "send code", "continue"])

    if (!clicked) {
      logger.warn("Could not find Done button")
      return false
    }

    return true
  }
}

export default PasswordHandler
