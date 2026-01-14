import * as fs from "fs"
import * as path from "path"
import { logger } from "./logger"

/**
 * Generates human-like username for email registration
 * @returns Random username in format: firstName_randomSuffix
 */
export function generateHumanUsername(): string {
  const firstNames = [
    "john",
    "mike",
    "alex",
    "david",
    "chris",
    "steve",
    "tom",
    "james",
    "paul",
    "mark",
    "ryan",
    "kevin",
    "jason",
    "brian",
    "eric",
    "adam",
    "nick",
    "danny",
    "rob",
    "matt",
    "luke",
    "jake",
    "sam",
    "brandon",
  ]

  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)]
  const suffixLength = Math.floor(Math.random() * 3) + 3
  let suffix = ""
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"

  for (let i = 0; i < suffixLength; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return `${firstName}_${suffix}`
}

/**
 * Generates secure random password meeting Crossfire Legends requirements
 * @returns Password string (8-20 characters) with at least two character groups: letters, digits, special symbols (@#$%^&*~:)
 */
export function generateSecurePassword(): string {
  const length = Math.floor(Math.random() * 13) + 8 // 8-20 characters
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const lowercase = "abcdefghijklmnopqrstuvwxyz"
  const numbers = "0123456789"
  const symbols = "@#$%^&*~:)" // Only valid symbols for Crossfire Legends

  // Ensure at least 2 groups are used
  const requiredGroups = Math.floor(Math.random() * 3) + 2 // 2-4 groups
  const availableGroups = [
    { name: 'upper', chars: uppercase },
    { name: 'lower', chars: lowercase },
    { name: 'digits', chars: numbers },
    { name: 'symbols', chars: symbols }
  ]

  // Randomly select required number of groups
  const selectedGroups = availableGroups
    .sort(() => Math.random() - 0.5)
    .slice(0, requiredGroups)

  // Start with one character from each required group
  const password: string[] = []
  for (const group of selectedGroups) {
    const char = group.chars[Math.floor(Math.random() * group.chars.length)]
    password.push(char)
  }

  // Fill remaining length with any character from selected groups only
  const allSelectedChars = selectedGroups.map(g => g.chars).join('')
  for (let i = password.length; i < length; i++) {
    password.push(allSelectedChars[Math.floor(Math.random() * allSelectedChars.length)])
  }

  // Shuffle the password
  for (let i = password.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[password[i], password[j]] = [password[j], password[i]]
  }

  return password.join("")
}

/**
 * Saves successful account credentials to valid.txt
 * @param email - Account email address
 * @param password - Account password
 */
export function saveSuccessfulAccount(email: string, password: string): void {
  const validFilePath = path.join(process.cwd(), "valid.txt")
  const accountLine = `${email}|${password}\n`

  try {
    if (!fs.existsSync(validFilePath)) {
      fs.writeFileSync(validFilePath, "")
    }

    const existingContent = fs.readFileSync(validFilePath, "utf-8")

    if (existingContent.includes(`${email}|`)) {
      logger.info(`Account ${email} already exists in valid.txt`)
      return
    }

    fs.appendFileSync(validFilePath, accountLine)
    logger.success(`Account saved to valid.txt: ${email}`)
  } catch (error) {
    logger.error(`Failed to save account to valid.txt: ${error}`)
  }
}

/**
 * Creates a delay promise
 * @param ms - Milliseconds to delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a random delay between min and max milliseconds
 * @param min - Minimum delay in milliseconds
 * @param max - Maximum delay in milliseconds
 */
export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return delay(ms)
}
