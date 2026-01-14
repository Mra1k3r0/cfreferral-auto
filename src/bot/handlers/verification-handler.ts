/**
 * VerificationHandler - Handles email verification and form interactions
 * Manages age verification, agreement checkboxes, and email code retrieval
 */

/* eslint-disable no-var */
declare var window: any
declare var document: any
/* eslint-enable no-var */

import * as fs from "fs"
import * as path from "path"
import type { Page } from "puppeteer-core"
import { delay, randomDelay } from "../../utils/helpers"
import { logger, colors } from "../../utils/logger"
import type ProxyManager from "../../proxy/proxy-manager"
import type { EmailService } from "../../services/email-service"

/**
 * Handles email verification, age verification, agreement checkboxes, and country selection
 */
export class VerificationHandler {
  private page: Page
  private proxyManager: ProxyManager | null
  private emailService: EmailService
  private config: any
  private hasRequestedCode: boolean = false

  /**
   * Creates a new VerificationHandler instance
   * @param page - Puppeteer page instance
   * @param proxyManager - Proxy manager for handling proxy connections
   * @param emailService - Email service for verification codes
   * @param config - Application configuration
   */
  constructor(page: Page, proxyManager: ProxyManager | null, emailService: EmailService, config: any) {
    this.page = page
    this.proxyManager = proxyManager
    this.emailService = emailService
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

  /**
   * Resets the verification state for a new session
   * Allows Get code button to be clicked again
   */
  resetVerificationState(): void {
    this.hasRequestedCode = false
    logger.debug("Verification state reset - Get code button can be clicked again")
  }

  /**
   * Checks if verification process is already complete
   * @returns Promise<boolean> - true if verification appears to be complete
   */

  async clickGetCodeButton(): Promise<boolean> {
    // Prevent clicking Get code button multiple times in the same session
    if (this.hasRequestedCode) {
      logger.info("Get code button already clicked this session, preventing duplicate clicks")
      return true // Return true to indicate success (we don't need to click again)
    }

    try {
      await this.page.waitForSelector('input[placeholder*="Verification code"], ._1egsyt72', {
        timeout: this.getProxyAwareTimeout(5000),
      })

      // Check if verification code is already filled - ROBUST SAFEGUARD
      const inputSelectors = ['input[placeholder*="Verification code"]']

      for (const selector of inputSelectors) {
        try {
          const inputElement = await this.page.$(selector)
          if (inputElement) {
            const existingValue = await this.page.evaluate((el: any) => el.value || "", inputElement)
            const isVisible = await this.page.evaluate((el: any) => {
              const style = window.getComputedStyle(el)
              return style.display !== "none" && style.visibility !== "hidden" && el.offsetWidth > 0
            }, inputElement)

            if (existingValue && existingValue.length >= 4 && isVisible) {
              logger.info(
                `VERIFICATION CODE ALREADY FILLED (${existingValue.length} chars: "${existingValue}"), BLOCKING GET CODE BUTTON CLICK`,
              )
              return true
            }
          }
        } catch (error) {
          // Continue to next selector
        }
      }

      logger.debug("No filled verification input found, proceeding with Get code button click")

      logger.info("Verification code input and Get code button found")
    } catch (e) {
      logger.warn("Verification code input not found")
    }

    const getCodeSelectors = ["button._1egsyt72"]

    for (const selector of getCodeSelectors) {
      try {
        const buttons = await this.page.$$(selector)
        for (const button of buttons) {
          const buttonText = await this.page.evaluate((el) => el.textContent || "", button)
          if (
            buttonText.toLowerCase().includes("get code") ||
            buttonText.toLowerCase().includes("send code") ||
            buttonText.toLowerCase().includes("send")
          ) {
            // Check if button has already been clicked to prevent persistent clicking
            const isAlreadyClicked = await this.page.evaluate((el) => {
              if ((el as any).dataset.clicked) {
                return true
              }
              return false
            }, button)

            if (isAlreadyClicked) {
              logger.info(`"Get code" button already clicked, skipping to prevent persistent clicking`)
              return true
            }

            const scrollBefore = await this.page.evaluate(() => window.scrollY)

            // Mark button as clicked to prevent future clicks
            await this.page.evaluate((el) => {
              ;(el as any).dataset.clicked = "true"
            }, button)

            await button.click()
            logger.info(`Clicked "Get code" button: ${colors.cyan(selector)}`)
            this.hasRequestedCode = true // Mark that we've requested a code this session

            // Set timeout to automatically reset hasRequestedCode if no code is received within 5 minutes
            // This prevents the flag from staying true forever if email delivery fails
            setTimeout(
              () => {
                if (this.hasRequestedCode) {
                  this.hasRequestedCode = false
                  logger.debug("Auto-reset hasRequestedCode flag after 5 minutes (no code received)")
                }
              },
              5 * 60 * 1000,
            ) // 5 minutes
            await this.proxyAwareDelay(1000)
            await this.proxyAwareDelay(1000)

            // Set timeout to clear the clicked flag after 5 seconds if we're still in the same state
            setTimeout(async () => {
              try {
                await this.page.evaluate((el) => {
                  delete (el as any).dataset.clicked
                }, button)
              } catch (e) {
                // Ignore errors if page has changed
              }
            }, 5000)

            try {
              const scrollAfter = await this.page.evaluate(() => window.scrollY)

              if (Math.abs(scrollAfter - scrollBefore) > 100) {
                logger.info("Page scrolled after Get code click - attempting to return to verification section")
                await this.page.evaluate(() => {
                  const verificationInput = document.querySelector('input[placeholder*="Verification code"]')
                  if (verificationInput) {
                    ;(verificationInput as any).scrollIntoView({ behavior: "smooth", block: "center" })
                  } else {
                    window.scrollTo({ top: 0, behavior: "smooth" })
                  }
                })
                await delay(2000)
              }
            } catch (pageError) {
              logger.warn("Page became unstable after Get code click, attempting recovery...")
              await delay(5000)
            }

            return true
          }
        }
      } catch (e) {
        continue
      }
    }

    // Fallback: try clicking any button that might be Get code
    try {
      const button = await this.page.$("button._1egsyt72")
      if (button) {
        // Check if button has already been clicked to prevent persistent clicking
        const isAlreadyClicked = await this.page.evaluate((el) => {
          if ((el as any).dataset.clicked) {
            return true
          }
          return false
        }, button)

        if (isAlreadyClicked) {
          logger.info(`"Get code" button already clicked (fallback), skipping to prevent persistent clicking`)
          return true
        }

        // Mark button as clicked to prevent future clicks
        await this.page.evaluate((el) => {
          ;(el as any).dataset.clicked = "true"
        }, button)

        await button.click()
        logger.info('Clicked "Get code" button (fallback)')
        this.hasRequestedCode = true // Mark that we've requested a code this session

        // Set timeout to automatically reset hasRequestedCode if no code is received within 5 minutes
        setTimeout(
          () => {
            if (this.hasRequestedCode) {
              this.hasRequestedCode = false
              logger.debug("Auto-reset hasRequestedCode flag after 5 minutes (no code received) - fallback")
            }
          },
          5 * 60 * 1000,
        ) // 5 minutes

        await this.proxyAwareDelay(2000)

        // Set timeout to clear the clicked flag after 5 seconds if we're still in the same state
        setTimeout(async () => {
          try {
            await this.page.evaluate((el) => {
              delete (el as any).dataset.clicked
            }, button)
          } catch (e) {
            // Ignore errors if page has changed
          }
        }, 5000)

        return true
      }
    } catch (e) {
      logger.warn('Could not click "Get code" button')
    }

    logger.error('Could not find "Get code" button - cannot proceed')
    return false
  }

  /**
   * Waits for and retrieves verification code from email service
   * @returns Promise<string | null> - verification code or null if not received
   */
  async waitForVerificationCode(): Promise<string | null> {
    colors.stepHeader(4, "Waiting for verification code")

    const originalProxySetting = this.config.useProxy
    if (this.config.useProxy === 5) {
      logger.info("STABLE MODE: Temporarily disabling proxy for email verification")
      this.proxyManager?.stopKeepAlive?.()
      this.config.useProxy = 0
    }

    let verificationCode: string | null = null

    if (this.config.smartEmailCheck) {
      verificationCode = await this.smartWaitForEmail()
    } else {
      verificationCode = await this.classicWaitForEmail()
    }

    if (originalProxySetting === 5) {
      logger.info("STABLE MODE: Restoring proxy for remaining operations")
      this.config.useProxy = 5
    }

    return verificationCode
  }

  /**
   * Smart email checking with adaptive timing and clean logging
   */
  private async smartWaitForEmail(): Promise<string | null> {
    const startTime = Date.now()
    const maxWaitTime = 120000 // 2 minutes max
    let checkInterval = 1000 // Start with 1s checks

    logger.info("Waiting for verification email...")

    while (Date.now() - startTime < maxWaitTime) {
      const code = await this.emailService.getVerificationCode()
      if (code) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        logger.success(`Email received in ${elapsed}s`)
        this.hasRequestedCode = false
        return code
      }

      await delay(checkInterval)

      // Adaptive timing: increase interval gradually (1s -> 2s -> 3s, max 5s)
      if (checkInterval < 5000) {
        checkInterval = Math.min(checkInterval + 500, 5000)
      }
    }

    logger.warn("Email not received within 2 minutes")
    return null
  }

  /**
   * Classic email checking (original method)
   */
  private async classicWaitForEmail(): Promise<string | null> {
    let verificationCode: string | null = null
    let attempts = 0
    const maxAttempts = this.config.maxEmailCheckAttempts

    while (!verificationCode && attempts < maxAttempts) {
      verificationCode = await this.emailService.getVerificationCode()
      if (!verificationCode) {
        attempts++
        logger.info(`Still waiting for verification email... (attempt ${attempts}/${maxAttempts})`)
        await delay(this.config.emailCheckInterval)
      } else {
        this.hasRequestedCode = false
        logger.debug("Verification code received - Get code button can be clicked again in future sessions")
      }
    }

    return verificationCode
  }

  /**
   * Quickly checks if verification code is already available without waiting
   * @returns Promise<string | null> - existing verification code or null
   */
  async checkExistingVerificationCode(): Promise<string | null> {
    logger.debug("Checking for existing verification code...")

    const originalProxySetting = this.config.useProxy
    if (this.config.useProxy === 5) {
      logger.debug("STABLE MODE: Temporarily disabling proxy for email check")
      this.proxyManager?.stopKeepAlive?.()
      this.config.useProxy = 0
    }

    // Just check once without waiting
    const verificationCode = await this.emailService.getVerificationCode()

    if (originalProxySetting === 5) {
      logger.debug("STABLE MODE: Restoring proxy")
      this.config.useProxy = 5
    }

    return verificationCode
  }

  /**
   * Fills the verification code input field
   * @param verificationCode - the verification code to enter
   * @returns Promise<boolean> - true if code was filled successfully
   */
  async fillVerificationCode(verificationCode: string): Promise<boolean> {
    const codeSelectors = [
          'input[placeholder*="Verification code"]', // WORKING SELECTOR - Successfully filled verification code
    ]

    for (const selector of codeSelectors) {
      try {
        const input = await this.page.$(selector)
        if (input) {
          await randomDelay(500, 1500)
          await input.click({ clickCount: 3 })
          await input.type("", { delay: 50 })
          await input.type(verificationCode, { delay: 250 })
          logger.success(`Filled verification code: ${verificationCode}`)

          const enteredValue = await this.page.evaluate((el) => (el as any).value, input)
          logger.info(`Verification code in field: "${colors.green(enteredValue)}"`)
          return true
        }
      } catch (e) {
        logger.warn(`Error filling verification code: ${e}`)
        continue
      }
    }

    logger.error("Could not fill verification code")
    return false
  }

  /**
   * Handles country/region selection with automatic weighted randomization
   * Prioritizes shorter country names for faster typing when using proxy
   * @returns Promise<boolean> - true if country selection completed
   */
  async handleCountrySelection(): Promise<boolean> {
    colors.stepHeader(5, "Checking for country/region selection")

    let countrySelected = false
    let retryCount = 0
    const maxRetries = 3

    while (!countrySelected && retryCount < maxRetries) {
      try {
        logger.info(`Country selection attempt ${retryCount + 1}/${maxRetries}`)

        await this.proxyAwareDelay(1000 + retryCount * 300) // Reduced initial delay

        const countrySelectors = [
          "#area", // WORKING SELECTOR - Found and used for country selection
        ]

        for (const selector of countrySelectors) {
          try {
            const countryElement = await this.page.$(selector)
            if (countryElement) {
              logger.info(`Found country/region selector: ${colors.cyan(selector)}`)

              const selectionCheck = await this.page.evaluate(() => {
                const selectedElements = document.querySelectorAll(
                  '.infinite-select-selection-item, [class*="selected"], [aria-selected="true"], option[selected]',
                )

                for (const element of selectedElements) {
                  const text =
                    (element as any).textContent?.trim() ||
                    (element as any).title?.trim() ||
                    (element as any).value?.trim()
                  if (
                    text &&
                    text.length > 2 &&
                    !text.toLowerCase().includes("select") &&
                    !text.toLowerCase().includes("choose") &&
                    !text.toLowerCase().includes("country")
                  ) {
                    return { isSelected: true, selectedCountry: text }
                  }
                }

                const selectElement = document.querySelector('select#area, select[name*="country"]')
                if (selectElement) {
                  const selectedOption = (selectElement as any).options[(selectElement as any).selectedIndex]
                  const selectedText = selectedOption ? selectedOption.textContent?.toLowerCase().trim() : ""
                  if (
                    selectedText &&
                    selectedText.length > 2 &&
                    !selectedText.includes("select") &&
                    !selectedText.includes("choose")
                  ) {
                    return { isSelected: true, selectedCountry: selectedOption.textContent?.trim() }
                  }
                }

                return { isSelected: false, selectedCountry: null }
              })

              const isUsingProxy = !!this.proxyManager?.getCurrentProxy()
              const countryList = ["Spain", "Philippines", "Panama", "Peru", "Zambia", "Zimbabwe", "Qatar"]
              const forceChangeCountries = ["United States", "United Kingdom"]

              if (selectionCheck.isSelected) {
                const selectedCountry = selectionCheck.selectedCountry || ""
                const isAllowedCountry = countryList.some((c) =>
                  selectedCountry.toLowerCase().includes(c.toLowerCase()),
                )
                const mustForceChange = forceChangeCountries.some((c) =>
                  selectedCountry.toLowerCase().includes(c.toLowerCase()),
                )

                if (isAllowedCountry && !mustForceChange) {
                  logger.success(`Country already selected: ${selectedCountry} ✓`)
                  countrySelected = true
                  break
                } else if (mustForceChange) {
                  logger.info(`Country ${selectedCountry} requires change, selecting random country...`)
                } else if (this.config.disableCountryDropdown && !isUsingProxy) {
                  logger.success(`Country already selected by site: ${selectedCountry} (respected auto-selection)`)
                  countrySelected = true
                  break
                } else {
                  logger.info(`Selecting random country...`)
                }
              } else {
                logger.info("No country pre-selected, proceeding with dropdown selection...")
              }

              await countryElement.click()
              logger.info(`Clicked country/region selector: ${selector}`)
              await this.proxyAwareDelay(800)

              // Clear existing text
              await this.page.keyboard.down("Control")
              await this.page.keyboard.press("a")
              await this.page.keyboard.up("Control")
              await this.page.keyboard.press("Backspace")
              await this.proxyAwareDelay(200)

              const weights = countryList.map((country) => {
                const length = country.length
                return Math.max(1, Math.floor(50 / Math.pow(length, 0.8)))
              })

              const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
              let random = Math.random() * totalWeight

              let randomCountry: string = ""
              for (let i = 0; i < countryList.length; i++) {
                random -= weights[i]
                if (random <= 0) {
                  randomCountry = countryList[i]
                  break
                }
              }
              randomCountry = randomCountry || countryList.reduce((a, b) => (a.length <= b.length ? a : b))

              await this.page.keyboard.type(randomCountry, { delay: 150 })
              logger.info(`Typed country name: ${randomCountry}`)

              await this.proxyAwareDelay(1000)

              const selectionResult = await this.page.evaluate((countryName) => {
                const options = document.querySelectorAll(
                  'li[class*="option"], [class*="dropdown"] li, .ant-select-dropdown li, .infinite-select-dropdown li',
                )

                for (const option of options) {
                  const text = (option as any).textContent?.trim() || ""
                  if (text.toLowerCase().includes(countryName.toLowerCase()) || text === countryName) {
                    ;(option as any).click()
                    return text
                  }
                }

                return null
              }, randomCountry)

              if (selectionResult) {
                logger.success(`Selected country: ${selectionResult}`)
                countrySelected = true
                await this.proxyAwareDelay(500)
              } else {
                await this.page.keyboard.press("Enter")
                logger.success(`Selected country by Enter key: ${randomCountry}`)
                countrySelected = true
                await this.proxyAwareDelay(500)
              }

              const selectedCountryName = selectionResult || randomCountry
              try {
                const ageCheckbox = await this.page.$("#adultAge")
                if (ageCheckbox) {
                  const ageCheckedAfterCountry = await this.page.evaluate((el) => (el as any).checked, ageCheckbox)
                  const ageTextAfterCountry = await this.page.evaluate((el) => {
                    const label = (el as any).closest("label")
                    return label ? label.textContent?.trim() : "Unknown"
                  }, ageCheckbox)

                  logger.debug(
                    `After selecting ${selectedCountryName}: age checked=${ageCheckedAfterCountry}, text="${ageTextAfterCountry?.substring(0, 50)}..."`,
                  )

                  if (ageCheckedAfterCountry && !this.config.enableAgeConfirmation) {
                    logger.warn(`Age checkbox was auto-checked after selecting ${selectedCountryName}!`)
                  }
                }
              } catch (e) {
                logger.warn(`Could not check age checkbox after country selection: ${e}`)
              }

              break
            }
          } catch (e) {
            logger.warn(`Error with selector ${selector}: ${e}`)
            continue
          }
        }

        if (!countrySelected) {
          retryCount++
          if (retryCount < maxRetries) {
            logger.warn(`Country selection failed, retrying in 1 second... (${retryCount}/${maxRetries})`)
            await this.proxyAwareDelay(1000) // Reduced retry delay
          }
        }
      } catch (countryError) {
        logger.warn(`Country selection error (attempt ${retryCount + 1}): ${countryError}`)
        retryCount++
        if (retryCount < maxRetries) {
          await this.proxyAwareDelay(1000)
        }
      }
    }

    if (countrySelected) {
      logger.success("Country/region selection handled successfully")
      await this.proxyAwareDelay(800)
    } else {
      logger.warn("Country/region selection failed after all retries - continuing anyway")
    }

    return countrySelected
  }

  /**
   * Handles age verification by finding and filling age input field
   * @returns Promise<boolean> - true if age was entered successfully
   */
  async handleAgeVerification(): Promise<boolean> {
    logger.info("Checking for age verification...")

    try {
      const ageInput = await this.page.$(
        'input[id*="age"]:not([placeholder*="code"]):not([placeholder*="verification"]):not([placeholder*="verify"]):not([placeholder*="otp"])',
      )

      if (ageInput) {
        const age = 33
        await ageInput.click({ clickCount: 3 })
        await this.proxyAwareDelay(300)
        await ageInput.type(age.toString(), { delay: 120 })
        logger.success(`Entered age: ${age}`)
        return true
      }

      logger.debug("No age input field found")
      return false
    } catch (error) {
      logger.warn(`Age verification error: ${error}`)
      return false
    }
  }

  /**
   * Handles agreement checkbox interactions based on configuration
   * Checks required agreements and prevents age confirmation when disabled
   * @returns Promise<boolean> - true if checkbox handling completed
   */
  async handleAgreementCheckboxes(): Promise<boolean> {
    logger.info("Looking for agreement checkboxes...")

    try {
      const allCheckboxes = await this.page.$$('input[type="checkbox"]')
      logger.info(`Found ${allCheckboxes.length} total checkboxes on page`)

      for (let i = 0; i < allCheckboxes.length; i++) {
        const checkbox = allCheckboxes[i]
        const id = await this.page.evaluate((el) => (el as any).id || "", checkbox)
        const isChecked = await this.page.evaluate((el) => (el as any).checked, checkbox)
        const labelText = await this.page.evaluate((el) => {
          const label = el.closest("label")
          return label ? label.textContent?.trim()?.substring(0, 30) + "..." : ""
        }, checkbox)

        if (id) {
          logger.debug(`Checkbox #${i}: id=${id}, checked=${isChecked}, label="${labelText}"`)
        }
      }
    } catch (e) {
      logger.warn(`Could not log initial checkbox states: ${e}`)
    }

    let checkboxCount = 0

    if (!this.config.enableAgeConfirmation) {
      try {
        await this.page.evaluate(() => {
          const ageCheckbox = document.getElementById("adultAge") as any
          if (ageCheckbox) {
            ageCheckbox.checked = false
            ageCheckbox.disabled = true

            try {
              Object.defineProperty(ageCheckbox, "checked", {
                get: () => false,
                set: () => false,
                configurable: true,
              })
            } catch (e) {
              logger.debug("Could not override checked property, using event prevention only")
            }

            const preventCheck = (e: any) => {
              ageCheckbox.checked = false
              e.preventDefault()
              e.stopImmediatePropagation()
            }

            ageCheckbox.addEventListener("change", preventCheck, true)
            ageCheckbox.addEventListener("click", preventCheck, true)
            ageCheckbox.addEventListener("input", preventCheck, true)
          }
        })
        logger.info("Proactive age confirmation protection applied")
      } catch (e) {
        logger.warn(`Could not apply proactive age confirmation protection: ${e}`)
      }
    }

    if (this.config.enableAgeConfirmation) {
      const requiredSelectors = [
        "#agreedPp", // Privacy Policy (required)
        "#agreedTos", // Terms of Service (required)
        "#agreedAllLi", // Combined agreement (required)
      ]

      for (const selector of requiredSelectors) {
        try {
          const checkbox = await this.page.$(selector)
          if (checkbox) {
            const isChecked = await this.page.evaluate((el) => (el as any).checked, checkbox)
            if (!isChecked) {
              await checkbox.click()
              checkboxCount++
              logger.info(`Checked agreement: ${colors.cyan(selector)}`)
              await this.proxyAwareDelay(300)
            }
          }
        } catch (e) {
          continue
        }
      }

      try {
        const ageCheckbox = await this.page.$("#adultAge")
        if (ageCheckbox) {
          const isChecked = await this.page.evaluate((el) => (el as any).checked, ageCheckbox)
          if (!isChecked) {
            await ageCheckbox.click()
            checkboxCount++
            logger.info("Checked age confirmation")
            await this.proxyAwareDelay(300)
          } else {
            logger.debug("Age confirmation already checked")
          }
        }
      } catch (e) {
        logger.warn(`Could not check age confirmation: ${e}`)
      }
    } else {
      const allowedSelectors = ["#agreedAllLi", "#agreedIsEmail"]

      for (const selector of allowedSelectors) {
        try {
          const checkbox = await this.page.$(selector)
          if (checkbox) {
            const isChecked = await this.page.evaluate((el) => (el as any).checked, checkbox)
            if (!isChecked) {
              await checkbox.click()
              checkboxCount++
              logger.info(`Checked agreement: ${colors.cyan(selector)}`)
              await this.proxyAwareDelay(300)

              if (!this.config.enableAgeConfirmation) {
                try {
                  const ageState = await this.page.evaluate(() => {
                    const ageCheckbox = document.getElementById("adultAge") as any
                    return ageCheckbox ? { checked: ageCheckbox.checked, disabled: ageCheckbox.disabled } : null
                  })

                  if (ageState && ageState.checked && !ageState.disabled) {
                    logger.warn(`Age confirmation auto-checked after clicking ${selector}, unchecking...`)
                    await this.page.evaluate(() => {
                      const ageCheckbox = document.getElementById("adultAge") as any
                      if (ageCheckbox) {
                        ageCheckbox.checked = false
                      }
                    })
                  }
                } catch (e) {
                  logger.warn(`Could not check age state after ${selector}: ${e}`)
                }
              }
            }
          }
        } catch (e) {
          continue
        }
      }

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ageCheckbox = await this.page.$("#adultAge")
          if (ageCheckbox) {
            const isChecked = await this.page.evaluate((el) => (el as any).checked, ageCheckbox)
            const ageText = await this.page.evaluate((el) => {
              const label = (el as any).closest("label")
              return label ? label.textContent?.trim() : "Unknown"
            }, ageCheckbox)

            logger.info(
              `Age checkbox state (attempt ${attempt + 1}): checked=${isChecked}, text="${ageText?.substring(0, 50)}..."`,
            )

            if (isChecked) {
              logger.info(`Age confirmation was checked (attempt ${attempt + 1}), unchecking...`)
              await ageCheckbox.click() // Uncheck if it was auto-checked
              await this.proxyAwareDelay(500)

              const stillChecked = await this.page.evaluate((el) => (el as any).checked, ageCheckbox)
              if (!stillChecked) {
                logger.info("Successfully unchecked age confirmation")
                break
              } else {
                logger.warn(`Failed to uncheck age confirmation on attempt ${attempt + 1}`)
              }
            } else {
              logger.debug("Age confirmation already unchecked")
              break
            }
          } else {
            logger.warn(`Age checkbox element not found on attempt ${attempt + 1}`)
          }
        } catch (e) {
          logger.warn(`Could not handle age confirmation unchecking (attempt ${attempt + 1}): ${e}`)
          await this.proxyAwareDelay(300)
        }
      }

      try {
        const masterCheckbox = await this.page.$("#agreedAllLi")
        if (masterCheckbox) {
          const isChecked = await this.page.evaluate((el) => (el as any).checked, masterCheckbox)
          if (isChecked) {
            logger.info("Master checkbox was checked, unchecking to prevent auto-checking age confirmation")
            await masterCheckbox.click()
            await this.proxyAwareDelay(300)
          }
        }
      } catch (e) {
        logger.warn(`Could not handle master checkbox: ${e}`)
      }

      logger.info("Age confirmation checkbox skipped (disabled in config)")
    }

    const optionalSelectors = ["#agreedIsEmail", "#agreedKoNightEmail"]

    for (const selector of optionalSelectors) {
      try {
        const checkbox = await this.page.$(selector)
        if (checkbox) {
          const isChecked = await this.page.evaluate((el) => (el as any).checked, checkbox)
          if (!isChecked) {
            await checkbox.click()
            checkboxCount++
            logger.debug(`Checked optional agreement: ${selector}`)
            await this.proxyAwareDelay(200)
          }
        }
      } catch (e) {
        continue
      }
    }

    try {
      await this.page.evaluate(() => {
        const labels = document.querySelectorAll('label[class*="checkbox"], label[for*="agree"]')
        labels.forEach((label: any) => {
          const input = label.querySelector('input[type="checkbox"]') || document.getElementById(label.htmlFor)
          if (input && !input.checked) {
            label.click()
          }
        })
      })
    } catch (e) {
      // Ignore errors
    }

    if (!this.config.enableAgeConfirmation) {
      try {
        await this.page.evaluate(() => {
          const ageCheckbox = document.getElementById("adultAge") as any
          if (ageCheckbox) {
            ageCheckbox.checked = false
            ageCheckbox.disabled = true

            try {
              Object.defineProperty(ageCheckbox, "checked", {
                get: () => false,
                set: (value: boolean) => {
                  if (value) {
                    console.warn("Age confirmation checkbox was attempted to be checked - blocking")
                    setTimeout(() => {
                      ageCheckbox.checked = false
                    }, 10)
                  }
                  return false
                },
                configurable: true,
              })
            } catch (e) {
              console.warn("Could not configure checked property override, using event prevention only")
            }

            ageCheckbox.addEventListener("change", (e: any) => {
              if (ageCheckbox.checked) {
                console.warn("Age confirmation checkbox change event blocked")
                ageCheckbox.checked = false
                e.preventDefault()
                e.stopPropagation()
              }
            })

            ageCheckbox.addEventListener("click", (e: any) => {
              if (!ageCheckbox.disabled) {
                console.warn("Age confirmation checkbox click blocked")
                e.preventDefault()
                e.stopPropagation()
                ageCheckbox.checked = false
              }
            })

            console.log("Age confirmation checkbox disabled and protected")
          }
        })

        await this.proxyAwareDelay(100)
        const finalState = await this.page.evaluate(() => {
          const ageCheckbox = document.getElementById("adultAge") as any
          return ageCheckbox ? ageCheckbox.checked : null
        })

        if (finalState) {
          logger.error("CRITICAL: Age confirmation protection failed - checkbox is still checked!")
        } else {
          logger.info("Age confirmation protection successful - checkbox disabled and unchecked")
        }
      } catch (e) {
        logger.error(`Could not apply age confirmation protection: ${e}`)
      }
    }

    if (!this.config.enableAgeConfirmation) {
      try {
        const finalAgeState = await this.page.evaluate(() => {
          const ageCheckbox = document.getElementById("adultAge") as any
          const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).map((cb) => ({
            id: (cb as any).id,
            checked: (cb as any).checked,
          }))
          return {
            ageChecked: ageCheckbox ? ageCheckbox.checked : null,
            ageDisabled: ageCheckbox ? ageCheckbox.disabled : null,
            allCheckboxes,
          }
        })

        if (finalAgeState.ageChecked) {
          logger.error(`FINAL CHECK FAILED: Age confirmation is still checked! Disabled: ${finalAgeState.ageDisabled}`)
          logger.error(`All checkbox states: ${JSON.stringify(finalAgeState.allCheckboxes)}`)

          await this.page.evaluate(() => {
            const ageCheckbox = document.getElementById("adultAge") as any
            if (ageCheckbox) {
              ageCheckbox.checked = false
              ageCheckbox.disabled = true
            }
          })
          logger.warn("Emergency age confirmation uncheck applied")
        } else {
          logger.info("Final verification: Age confirmation properly unchecked")
        }
      } catch (e) {
        logger.error(`Could not perform final age verification: ${e}`)
      }
    }

    if (checkboxCount > 0) {
      logger.success(`Checked ${checkboxCount} agreement checkbox(es)`)
    } else {
      logger.info("No unchecked agreement checkboxes found")
    }

    return true
  }
}

export default VerificationHandler
