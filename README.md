# OwoFarm

A fully automated farming bot for the popular Owo bot on Discord. This bot is designed to automate various Owo bot commands like hunting, battling, and more, helping you collect resources and improve your progress effortlessly!

## Features

- **Auto Hunting (`owo hunt`)**: Automatically hunts for animals with customizable intervals.
- **Auto Battling (`owo battle`)**: Engage in battles with predefined strategies and commands.
- **Customizable Timing**: Set intervals between commands to avoid detection.
- **Auto Use of Gems**: Automatically uses gems in the game without manual intervention.
- **Auto Quest Checking**: Automatically checks for available quests and updates quest progress.
- **Automatic Zoo View**: Automatically displays the zoo collection and updates it in real-time.
- **Daily Claim Automation**: Automatically claims daily rewards without user input.
- **Calculating Exp from Hunting**: Automatically calculates experience points earned from hunting (battle exp feature is in progress).
- **Auto Inventory Item Collection**: Automatically collects all items available in the player's inventory.
- **Auto Use of Lootbox/Fabled Lootbox/Crate**: Automatically opens lootboxes, fabled lootboxes, and crates.
- **Owo Pray/Curse Automation (Set Target)**: Automatically performs "owo pray" or "owo curse" commands, with the option to set a target.
- **Owo Cookie Automation (Set Target)**: Automatically sends "owo cookie" with the ability to specify a target.
- **Dynamic Configuration Without App Restart**: Allows configuration updates dynamically without restarting the application.

- **Anti-Detection Measures**: Implements randomization in command timings to reduce the risk of being flagged by Discord or Owo bot's anti-bot systems.
- **Support for Multiple Accounts**: Can be configured to run on multiple Discord accounts.

## Setup & Usage

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Paiiss/owofarm.git
   cd owofarm
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure the bot**:

   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Add your **Discord user account token** to `.env` — see [Getting your Discord user token](#getting-your-discord-user-token).
   - Customize the bot's settings in `src/config/config.ts` as needed.

4. **Build the bot**:

   ```bash
   npm run build
   ```

5. **Run the bot**:
   ```bash
   npm start
   ```

## Getting your Discord user token

OwoFarm logs in as **your Discord account**, not a bot application. You need a **user account token** — not a bot token from the [Discord Developer Portal](https://discord.com/developers/applications).

> **Warning:** Your token is equivalent to your password. Never share it, commit it to git, or paste it into untrusted sites. If it is exposed, change your Discord password immediately to invalidate it.

**Steps (browser):**

1. Open [Discord in your browser](https://discord.com/app) and log in to the account you want to farm with.
2. Open **Developer Tools** (`F12` or `Ctrl+Shift+I` on Windows/Linux, `Cmd+Option+I` on macOS).
3. Go to the **Network** tab.
4. Reload the page or switch channels so requests appear.
5. In the filter box, type `api` and click any request to `discord.com/api/...`.
6. Under **Request Headers**, find `authorization`. The value is your token (a long string; it is **not** prefixed with `Bot `).
7. Copy that value into `.env`:
   ```env
   TOKEN="your_token_here"
   ```

For multiple accounts, separate tokens with commas: `TOKEN="token1,token2"`.

## Notes

- Use this bot responsibly and at your own risk. Automating Discord bots can potentially violate Discord’s and Owo bot’s terms of service.
- This project is meant for educational purposes only.
