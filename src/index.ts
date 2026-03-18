#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getConfig } from "./config.js";
import { StateStore } from "./core/state_store.js";
import { GmailConnector } from "./connectors/gmail.js";
import { CalendarConnector } from "./connectors/calendar.js";
import { DailyDigestJob } from "./jobs/daily_digest.js";

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const command = process.argv[2] || "dev";

  try {
    switch (command) {
      case "digest:run":
        await runDigest(false);
        break;

      case "digest:dry-run":
        await runDigest(true);
        break;

      case "dev":
      case "help":
      case "--help":
      case "-h":
        console.log(
          "OpenClaw Gmail Agent - Development Mode\n" +
          "Available commands:\n" +
          "  npm run digest:dry-run  - Preview digest without sending\n" +
          "  npm run digest:run      - Run digest and send email\n" +
          "  npm run test            - Run test suite\n" +
          "  npm run build           - Build TypeScript\n" +
          "  npm run type-check      - Run type checking\n" +
          "  npm run lint            - Run linter\n\n" +
          "Setup commands (first time):\n" +
          "  npx tsx src/utils/authenticate.ts - Authenticate with Google\n\n" +
          "See README.md for detailed documentation."
        );
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

async function runDigest(dryRun: boolean): Promise<void> {
  // Load configuration
  const config = getConfig();

  // Initialize state store
  const stateStore = new StateStore();

  // Check if we have OAuth tokens
  const gmailToken = stateStore.getOAuthToken("gmail");
  const calendarToken = stateStore.getOAuthToken("calendar");

  if (!gmailToken || !calendarToken) {
    console.error(
      "Missing OAuth tokens. Please run the authentication flow first."
    );
    console.error(
      "Visit the OAuth setup section of the README for instructions."
    );
    process.exit(1);
  }

  // Initialize connectors
  const gmail = new GmailConnector(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
    stateStore,
    gmailToken.accessToken,
    gmailToken.refreshToken
  );

  const calendar = new CalendarConnector(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
    stateStore,
    calendarToken.accessToken,
    calendarToken.refreshToken
  );

  // Run digest job
  const job = new DailyDigestJob(config, gmail, calendar, stateStore);

  if (dryRun) {
    // Preview mode
    const html = await job.previewDigest();
    
    // Write preview to a file
    const previewDir = path.join(process.cwd(), "previews");
    if (!fs.existsSync(previewDir)) {
      fs.mkdirSync(previewDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const previewFile = path.join(previewDir, `digest_${timestamp}.html`);
    
    fs.writeFileSync(previewFile, html);
    console.log(`\n✓ Digest preview saved to: ${previewFile}`);
    console.log("Open this file in a browser to see the formatted digest.\n");
  } else {
    // Actually send digest
    const digest = await job.run(false);
    
    if (digest.totalEmailsProcessed > 0) {
      console.log("\n✓ Daily digest sent successfully!");
      console.log(`  - Action items: ${digest.needsAction.length}`);
      console.log(`  - Invitations: ${digest.invitesAndTimeSensitive.length}`);
      console.log(`  - Important FYI: ${digest.importantFyi.length}`);
      console.log(`  - Low priority marked read: ${digest.lowPrioritySkippedCount}`);
      
      if (digest.createdCalendarEventIds.length > 0) {
        console.log(
          `  - Calendar events created: ${digest.createdCalendarEventIds.length}`
        );
      }
    } else {
      console.log("✓ No new emails to summarize");
    }
  }

  stateStore.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
