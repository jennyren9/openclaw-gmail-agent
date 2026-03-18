import * as dotenv from "dotenv";
import path from "path";
import { AgentConfig } from "./types/index.js";

// Load .env file
dotenv.config();

/**
 * Load and validate configuration from environment variables
 */
function loadConfig(): AgentConfig {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "PRIMARY_GMAIL_ACCOUNT",
    "DIGEST_RECIPIENT_EMAIL",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        `Please copy .env.example to .env and fill in the required values.`
    );
  }

  const config: AgentConfig = {
    primaryGmailAccount: process.env.PRIMARY_GMAIL_ACCOUNT!,
    googleClientId: process.env.GOOGLE_CLIENT_ID!,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI!,
    digestRecipient: process.env.DIGEST_RECIPIENT_EMAIL!,
    digestSchedule: process.env.DIGEST_SCHEDULE || "0 8 * * *",
    digestTimezone: process.env.DIGEST_TIMEZONE || "America/Los_Angeles",
    emailLookbackHours: parseInt(process.env.EMAIL_LOOKBACK_HOURS || "24", 10),
    databasePath:
      process.env.DATABASE_PATH ||
      path.join(process.cwd(), "data", "openclaw.db"),
    markLowPriorityAsRead:
      process.env.MARK_LOW_PRIORITY_AS_READ !== "false",
    markFyiAsReadAfterDigest:
      process.env.MARK_FYI_AS_READ_AFTER_DIGEST === "true",
    markActionItemsAsRead:
      process.env.MARK_ACTION_ITEMS_AS_READ === "true",
    dryRun: process.env.DRY_RUN === "true",
    openaiApiKey: process.env.OPENAI_API_KEY,
    claudeApiKey: process.env.CLAUDE_API_KEY,
  };

  return config;
}

/**
 * Get singleton config instance
 */
let cachedConfig: AgentConfig | null = null;

export function getConfig(): AgentConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Set config (useful for testing)
 */
export function setConfig(config: AgentConfig): void {
  cachedConfig = config;
}
