import axios, { type AxiosResponse } from "axios"
import { logger } from "../utils/logger"
import { generateHumanUsername } from "../utils/helpers"
import type { TempEmailAccount, GetEmailListResponse } from "../types"

/**
 * EmailService - Handles temporary email creation and verification code retrieval
 */
export class EmailService {
  private tempEmailAccount: TempEmailAccount | null = null
  private currentDomain: string = "guerrillamail.com"
  private baseUrl: string = "https://api.guerrillamail.com"

  private getRequestHeaders(): Record<string, string> {
    return {
      accept: "application/json, text/plain, */*",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
  }

  /**
   * Creates a temporary email account using GuerrillaMail API
   * @returns Promise resolving to TempEmailAccount with email address and session token
   * @throws Error if email creation fails
   */
  async createTempEmail(): Promise<TempEmailAccount> {
    logger.info("📧 Creating temporary email account...")

    const username = generateHumanUsername()

    const url = `${this.baseUrl}/ajax.php?f=set_email_user`
    const formData = new URLSearchParams()
    formData.append("email_user", username)
    formData.append("lang", "en")

    try {
      const response: AxiosResponse<any> = await axios.post(url, formData, {
        headers: this.getRequestHeaders(),
        timeout: 10000,
        proxy: undefined,
      })
      const account = response.data

      if (account.email_addr) {
        this.tempEmailAccount = account
        // Extract domain from email address (API decides the domain)
        const emailParts = account.email_addr.split("@")
        this.currentDomain = emailParts.length > 1 ? emailParts[1] : "guerrillamail.com"
        logger.info(`✅ Temp email created: ${account.email_addr}`)
        return account
      } else {
        throw new Error("Failed to create temp email account - invalid response")
      }
    } catch (error) {
      logger.error(`❌ Failed to create temp email: ${error}`)
      throw error
    }
  }

  /**
   * Retrieves verification code from email inbox
   * Checks for emails from levelinfinite or containing verification keywords
   * @returns Verification code (4-8 digits) or null if not found
   */
  async getVerificationCode(): Promise<string | null> {
    if (!this.tempEmailAccount) {
      logger.error("❌ No temp email account available")
      return null
    }

    logger.debug("📨 Checking for verification email...")

    const params = new URLSearchParams()
    params.append("f", "get_email_list")
    params.append("sid_token", this.tempEmailAccount.sid_token)
    params.append("offset", "0")

    const url = `${this.baseUrl}/ajax.php?${params.toString()}`

    try {
      const response: AxiosResponse<GetEmailListResponse> = await axios.get(url, {
        headers: this.getRequestHeaders(),
        timeout: 10000,
        proxy: undefined,
      })

      if (response.data.list && response.data.list.length > 0) {
        for (const email of response.data.list) {
          if (this.isVerificationEmail(email)) {
            logger.info(`📧 Found verification email: ${email.mail_subject}`)
            logger.debug(`📄 Email excerpt: ${email.mail_excerpt}`)

            const code = this.extractVerificationCode(email)
            if (code) {
              logger.success(`🔢 Extracted verification code: ${code}`)
              return code
            } else {
              logger.warn("⚠️  Could not extract code from email content")
            }
          }
        }
      }

      logger.debug("No verification email found yet, will retry...")
      return null
    } catch (error) {
      logger.error(`❌ Failed to check emails: ${error}`)
      return null
    }
  }

  private isVerificationEmail(email: { mail_from: string; mail_subject: string }): boolean {
    const from = email.mail_from.toLowerCase()
    const subject = email.mail_subject.toLowerCase()

    return (
      from.includes("levelinfinite") ||
      subject.includes("verify") ||
      subject.includes("code") ||
      subject.includes("verification") ||
      subject.includes("confirm")
    )
  }

  private extractVerificationCode(email: { mail_subject: string; mail_excerpt?: string }): string | null {
    let codeMatch = email.mail_subject.match(/\b\d{4,8}\b/)
    if (!codeMatch && email.mail_excerpt) {
      codeMatch = email.mail_excerpt.match(/\b\d{4,8}\b/)
    }
    return codeMatch ? codeMatch[0] : null
  }

  getTempEmailAccount(): TempEmailAccount | null {
    return this.tempEmailAccount
  }

  getCurrentDomain(): string {
    return this.currentDomain
  }
}
