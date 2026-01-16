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
 * @returns Password string (6-20 characters) with at least two character groups: letters, digits, special symbols (@#$%^&*:)
 */
export function generateSecurePassword(): string {
  const groups = [
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    "@#$%^&*:)"
  ]

  const rand = (n: number) => Math.floor(Math.random() * n)
  const pick = (s: string) => s[rand(s.length)]

  const isShortPassword = Math.random() < 0.605
  const length = isShortPassword ? rand(7) + 6 : rand(8) + 13

  let selected
  if (isShortPassword) {
    const shuffled = [...groups].sort(() => Math.random() - 0.5)
    const [first, ...rest] = shuffled

    // If first group is letters (uppercase/lowercase), ensure second is digits/symbols
    const isLetters = first === groups[0] || first === groups[1]
    const second = isLetters
      ? rest.find(g => g === groups[2] || g === groups[3]) || rest[0]
      : rest[0]

    selected = [first, second]
  } else {
    selected = [...groups].sort(() => Math.random() - 0.5).slice(0, rand(3) + 2)
  }

  const chars = selected.join("")
  const password = [
    ...selected.map(pick),
    ...Array.from({ length: length - selected.length }, () => pick(chars))
  ]

  for (let i = password.length - 1; i > 0; i--) {
    const j = rand(i + 1)
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
