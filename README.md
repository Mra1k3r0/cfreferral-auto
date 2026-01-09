# Crossfire Legends Referral Bot

Automated Crossfire Legends account registration with email verification.

[![](https://img.shields.io/badge/version-1.0.5-blue.svg)](https://github.com/mra1k3r0/cflreferral-auto/releases)

## Table of Contents

- [Windows](#windows)
- [Linux/Mac](#linuxmac)
- [Android (Termux + Termux-X11)](#android-termux--termux-x11)
- [Configuration](#configuration)
- [Output Files](#output-files)
- [Requirements](#requirements)
- [Supported Browsers](#supported-browsers)

## Quick Start

<details>
<summary><strong>Windows</strong></summary>

#### Method 1: Batch File (Easiest)
1. Double-click `run.bat` (handles everything automatically)

#### Method 2: Command Line
```bash
npm install
npm run build
npm start
```

#### Method 3: Dev Mode (No Build)
```bash
npm install
npm run dev
```
</details>

<details>
<summary><strong>Linux/Mac</strong></summary>

```bash
npm install
npm run build
npm start
```

Or dev mode (no build):
```bash
npm install
npm run dev
```
</details>

<details>
<summary><strong>Android (Termux + Termux-X11)</strong></summary>

```bash
# Install required packages (bot auto-detects Chromium)
pkg install nodejs git chromium x11-repo
pkg install termux-x11-nightly

# Clone and setup project
git clone https://github.com/mra1k3r0/cflreferral-auto.git
cd cflreferral-auto
npm install
npm run build

# Start X11 server in background
termux-x11 :0 &

# Run bot with X11 display (auto-detects browser)
export DISPLAY=:0
npm start

# Or dev mode (no build): npm run dev
```
</details>

## Configuration

### Proxy Settings
Edit `src/config/defaults.ts`:
```typescript
useProxy: 1,        // 0=direct, 1=HTTP file, 2=HTTPS file, 3=SOCKS4, 4=SOCKS5, 5=stable
proxyFile: "proxy.txt"  // Your proxy list
enableSecureConnection: false,  // Enable/disable secure connection manager
```

### Adding Proxies
Edit `proxy.txt` with your proxy details:
```
# Format: host:port:username:password (for authenticated proxies)
# Format: host:port (for non-authenticated proxies)

# Examples:
http://proxy.example.com:8080:username:password
socks5://socks.example.com:1080:username:password
192.168.1.100:3128:user:pass123
proxy.provider.com:8080
```

Set `useProxy: 1` in `src/config/defaults.ts` for HTTP proxies, `useProxy: 4` for SOCKS5, etc.

### Optional Configuration

The bot automatically generates temporary emails for registration. If you prefer to use your own credentials:

#### Using .env File (Optional)
Create a `.env` file in the project root:
```bash
# Copy and modify this content:
REFERRAL_CODE=your-referral-code
```

**Note**: The bot automatically generates temp emails. Only create `.env` if you want to use a custom referral code. The `.env` file is automatically ignored by Git for security.

### Or Environment Variables
```bash
export REFERRAL_CODE="your-referral-code"
```

#### Continuous Mode (Auto-Restart)
Enable automatic continuous registration by editing `src/config/defaults.ts`:
```typescript
continuousMode: true,           // Enable auto-restart after each successful registration
maxContinuousSessions: 50,      // Maximum sessions before stopping (0 = unlimited)
inactivityTimeout: 300000,      // Stop if no activity for 5 minutes (300000ms)
```


## Output Files

- `valid.txt` - Successfully created accounts
- `logs/bot.log` - Execution logs
- Screenshots automatically saved on errors

## Requirements

- Node.js 16+
- npm
- **Browser**: Chromium/Chrome/Firefox (auto-detected)
- For Android: Termux + Termux-X11 (optional)

## Supported Browsers

The bot uses **Puppeteer Core** and automatically detects and configures:
- **Chromium** (recommended for Termux/Android)
- **Google Chrome** (Windows/macOS/Linux)
- **Firefox**
- Other compatible browsers

**Note**: Puppeteer Core requires a system-installed browser and automatically configures the executable path.

## Disclaimer

Educational purposes only. Use responsibly.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
