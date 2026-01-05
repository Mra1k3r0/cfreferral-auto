/**
 * Banner utilities for displaying CFL BOT application branding
 * Provides responsive ASCII art banners with dynamic version loading
 */

import * as fs from "fs"
import * as path from "path"

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  bgCyan: "\x1b[46m",
  bgMagenta: "\x1b[45m",
}

/**
 * Get the application version from package.json
 * @returns The version string from package.json or default fallback
 */
function getPackageVersion(): string {
  try {
    const packagePath = path.join(__dirname, "../../package.json")
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"))
    return packageJson.version || "1.0.0"
  } catch (error) {
    console.warn("Could not read package.json version, using default")
    return "1.0.0"
  }
}

/**
 * Calculate visible length of string with ANSI color codes removed
 */
function visibleLength(str: string): number {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "").length
}

/**
 * Pad a line to fit within borders with proper alignment
 */
function padLine(content: string, totalWidth: number, border = `${colors.cyan}║${colors.reset}`): string {
  const visible = visibleLength(content)
  const innerWidth = totalWidth - 2
  const padding = innerWidth - visible
  return `${border}${content}${" ".repeat(Math.max(0, padding))}${border}`
}

/**
 * Generate horizontal border with specified characters
 */
function horizontalBorder(width: number, left: string, mid: string, right: string): string {
  return `${colors.cyan}${left}${"═".repeat(width - 2)}${right}${colors.reset}`
}

/**
 * Generate large banner for terminals 80+ characters wide
 * @returns Formatted banner string with full ASCII art
 */
function generateLargeBanner(): string {
  const W = 77 // total width including borders

  const lines = [
    horizontalBorder(W, "╔", "═", "╗"),
    padLine("", W),
    padLine(
      `   ${colors.bright}${colors.magenta} ██████╗${colors.cyan}███████╗${colors.yellow}██╗     ${colors.reset}    ${colors.bright}${colors.green}██████╗  ${colors.blue}██████╗ ${colors.magenta}████████╗${colors.reset}`,
      W,
    ),
    padLine(
      `   ${colors.bright}${colors.magenta}██╔════╝${colors.cyan}██╔════╝${colors.yellow}██║     ${colors.reset}    ${colors.bright}${colors.green}██╔══██╗${colors.blue}██╔═══██╗${colors.magenta}╚══██╔══╝${colors.reset}`,
      W,
    ),
    padLine(
      `   ${colors.bright}${colors.magenta}██║     ${colors.cyan}█████╗  ${colors.yellow}██║     ${colors.reset}    ${colors.bright}${colors.green}██████╔╝${colors.blue}██║   ██║${colors.magenta}   ██║   ${colors.reset}`,
      W,
    ),
    padLine(
      `   ${colors.bright}${colors.magenta}██║     ${colors.cyan}██╔══╝  ${colors.yellow}██║     ${colors.reset}    ${colors.bright}${colors.green}██╔══██╗${colors.blue}██║   ██║${colors.magenta}   ██║   ${colors.reset}`,
      W,
    ),
    padLine(
      `   ${colors.bright}${colors.magenta}╚██████╗${colors.cyan}██║     ${colors.yellow}███████╗${colors.reset}    ${colors.bright}${colors.green}██████╔╝${colors.blue}╚██████╔╝${colors.magenta}   ██║   ${colors.reset}`,
      W,
    ),
    padLine(
      `   ${colors.bright}${colors.magenta} ╚═════╝${colors.cyan}╚═╝     ${colors.yellow}╚══════╝${colors.reset}    ${colors.bright}${colors.green}╚═════╝ ${colors.blue} ╚═════╝ ${colors.magenta}   ╚═╝   ${colors.reset}`,
      W,
    ),
    padLine("", W),
    horizontalBorder(W, "╠", "═", "╣"),
    padLine("", W),
    padLine(
      `   ${colors.dim}▸${colors.reset} ${colors.bright}${colors.white}CFL REFERRAL BOT${colors.reset}                      ${colors.yellow}⚡${colors.reset} ${colors.dim}Version${colors.reset} ${colors.green}${getPackageVersion()}${colors.reset}`,
      W,
    ),
    padLine(
      `   ${colors.dim}▸${colors.reset} ${colors.dim}Developed by${colors.reset} ${colors.magenta}${colors.bright}mra1k3r0${colors.reset}                         ${colors.cyan}◆${colors.reset} ${colors.dim}2026${colors.reset}`,
      W,
    ),
    padLine("", W),
    horizontalBorder(W, "╚", "═", "╝"),
  ]

  return "\n" + lines.join("\n") + "\n"
}

/**
 * Generate medium banner for terminals 55-79 characters wide
 * @returns Formatted banner string with compact layout
 */
function generateMediumBanner(): string {
  const W = 52

  const lines = [
    horizontalBorder(W, "╔", "═", "╗"),
    padLine("", W),
    padLine(
      `   ${colors.bright}${colors.magenta}▄█▀▀▀${colors.cyan}█▀▀▀▀${colors.yellow}█    ${colors.reset}  ${colors.bright}${colors.green}█▀▀▄ ${colors.blue}▄▀▀▀▄${colors.magenta}▀▀█▀▀${colors.reset}  `,
      W,
    ),
    padLine(
      `   ${colors.bright}${colors.magenta}█    ${colors.cyan}█▀▀  ${colors.yellow}█    ${colors.reset}  ${colors.bright}${colors.green}█▀▀▄ ${colors.blue}█   █${colors.magenta}  █  ${colors.reset}  `,
      W,
    ),
    padLine(
      `   ${colors.bright}${colors.magenta}▀▄▄▄${colors.cyan}█    ${colors.yellow}█▄▄▄▄${colors.reset}  ${colors.bright}${colors.green}█▄▄▀ ${colors.blue}▀▄▄▄▀${colors.magenta}  █  ${colors.reset}  `,
      W,
    ),
    padLine("", W),
    horizontalBorder(W, "╠", "═", "╣"),
    padLine(
      `  ${colors.yellow}⚡${colors.reset} ${colors.white}CFL REFERRAL BOT${colors.reset}  ${colors.dim}│${colors.reset}  ${colors.green}${getPackageVersion()}${colors.reset}  ${colors.dim}│${colors.reset}  ${colors.magenta}mra1k3r0${colors.reset} `,
      W,
    ),
    horizontalBorder(W, "╚", "═", "╝"),
  ]

  return "\n" + lines.join("\n") + "\n"
}

/**
 * Generate small banner for terminals 32-54 characters wide
 * @returns Formatted banner string with minimal layout
 */
function generateSmallBanner(): string {
  const W = 31
  const border = `${colors.cyan}│${colors.reset}`

  const lines = [
    `${colors.cyan}┌${"─".repeat(W - 2)}┐${colors.reset}`,
    padLine(
      `  ${colors.bright}${colors.magenta}C${colors.cyan}F${colors.yellow}L${colors.reset} ${colors.bright}${colors.green}B${colors.blue}O${colors.magenta}T${colors.reset}  ${colors.yellow}⚡${colors.reset}         `,
      W,
      border,
    ),
    `${colors.cyan}├${"─".repeat(W - 2)}┤${colors.reset}`,
    padLine(` ${colors.dim}Referral${colors.reset} ${colors.green}${getPackageVersion()}${colors.reset}          `, W, border),
    padLine(` ${colors.dim}by${colors.reset} ${colors.magenta}mra1k3r0${colors.reset}             `, W, border),
    `${colors.cyan}└${"─".repeat(W - 2)}┘${colors.reset}`,
  ]

  return "\n" + lines.join("\n") + "\n"
}

/**
 * Generate mini banner for terminals under 32 characters wide
 * @returns Formatted banner string with ultra-compact layout
 */
function generateMiniBanner(): string {
  const W = 22

  return `
${colors.cyan}${"━".repeat(W)}${colors.reset}
 ${colors.bright}${colors.magenta}C${colors.cyan}F${colors.yellow}L${colors.reset} ${colors.bright}${colors.green}B${colors.blue}O${colors.magenta}T${colors.reset} ${colors.yellow}⚡${colors.reset} ${colors.green}${getPackageVersion()}${colors.reset}
 ${colors.dim}by mra1k3r0${colors.reset}
${colors.cyan}${"━".repeat(W)}${colors.reset}
`
}

/**
 * Get the current terminal width
 * @returns Terminal width in characters or 80 as fallback
 */
function getTerminalWidth(): number {
  return process.stdout.columns || 80
}

/**
 * Display the appropriate banner based on terminal width
 */
function displayBanner(): void {
  const width = getTerminalWidth()

  console.clear()

  if (width >= 80) {
    console.log(generateLargeBanner())
  } else if (width >= 55) {
    console.log(generateMediumBanner())
  } else if (width >= 32) {
    console.log(generateSmallBanner())
  } else {
    console.log(generateMiniBanner())
  }

  // Footer info
  console.log(`${colors.dim}  Terminal width: ${width} cols${colors.reset}`)
  console.log()
}

/**
 * Display animated loading banner before showing the main banner
 * @returns Promise that resolves when animation completes
 */
async function animatedBanner(): Promise<void> {
  const frames = ["⠋", "⠙", "⠹", "⠸"]
  const loadingText = "Initializing CFL BOT"

  for (let i = 0; i < 4; i++) {
    process.stdout.write(`\r${colors.cyan}${frames[i % frames.length]}${colors.reset} ${loadingText}...`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  console.clear()
  displayBanner()
}

// Initialize banner on module load
animatedBanner()

export { displayBanner, animatedBanner, generateLargeBanner, generateMediumBanner, generateSmallBanner, generateMiniBanner }
