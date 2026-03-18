import { OAuth2Client } from "google-auth-library";
import http from "http";
import { URL } from "url";
import { getConfig } from "../config.js";
import { StateStore } from "../core/state_store.js";

/**
 * Helper to authenticate with Google and store tokens
 * Run with: npx ts-node src/utils/authenticate.ts
 */

const config = getConfig();
const stateStore = new StateStore(config.databasePath);

async function authenticate(): Promise<void> {
  console.log("🔐 OpenClaw Gmail Agent - OAuth Authentication\n");

  const oauth2Client = new OAuth2Client({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  });

  const gmailScopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
  ];

  const calendarScopes = ["https://www.googleapis.com/auth/calendar"];

  // Create local server for OAuth callback
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end("No callback URL");
        return;
      }

      const rl = new URL(req.url, `http://${req.headers.host}`);
      const authCode = rl.searchParams.get("code");
      const error = rl.searchParams.get("error");

      if (error) {
        console.error("❌ Authentication error:", error);
        res.writeHead(400);
        res.end(`Error: ${error}`);
        server.close();
        process.exit(1);
      }

      if (!authCode) {
        res.writeHead(400);
        res.end("No authorization code");
        return;
      }

      console.log("✓ Authorization code received, exchanging for tokens...\n");

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(authCode);

      res.writeHead(200);
      res.end(
        'Authorization successful! Tokens saved. You can close this window.'
      );

      // Store Gmail tokens
      console.log("📧 Storing Gmail OAuth tokens...");
      stateStore.storeOAuthToken(
        "gmail",
        tokens.access_token!,
        tokens.refresh_token,
        tokens.expiry_date,
        gmailScopes
      );
      console.log("✓ Gmail tokens saved\n");

      // For calendar, we need separate auth
      console.log("📅 For Google Calendar, please complete authorization in your browser...");
      console.log("   (Will open another window)\n");

      // AuthorizeCalendar
      await authenticateCalendar();

      console.log("\n✅ Authentication complete!");
      console.log("You can now run: npm run digest:run\n");

      server.close();
      stateStore.close();
      process.exit(0);
    } catch (err) {
      console.error("Error:", err);
      res.writeHead(500);
      res.end("Error during authentication");
      server.close();
      process.exit(1);
    }
  });

  server.listen(3000, () => {
    console.log("📍 Local server listening on http://localhost:3000\n");
    console.log("Opening Google authorization screen in your browser...\n");

    // Generate authorization URL for Gmail
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: gmailScopes,
      prompt: "consent",
    });

    console.log("Gmail Authorization URL:");
    console.log(authUrl);
    console.log("\nPlease authorize the application to access your Gmail account.\n");
  });
}

async function authenticateCalendar(): Promise<void> {
  const calendarOauth = new OAuth2Client({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
    redirectUri: config.googleRedirectUri,
  });

  const calendarScopes = ["https://www.googleapis.com/auth/calendar"];

  const calendarServer = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400);
        res.end("No callback URL");
        return;
      }

      const rl = new URL(req.url, `http://${req.headers.host}`);
      const authCode = rl.searchParams.get("code");
      const error = rl.searchParams.get("error");

      if (error) {
        console.error("❌ Calendar authentication error:", error);
        res.writeHead(400);
        res.end(`Error: ${error}`);
        calendarServer.close();
        return;
      }

      if (!authCode) {
        res.writeHead(400);
        res.end("No authorization code");
        return;
      }

      const { tokens } = await calendarOauth.getToken(authCode);

      res.writeHead(200);
      res.end(
        'Authorization successful! Tokens saved. You can close this window.'
      );

      console.log("📅 Storing Google Calendar OAuth tokens...");
      stateStore.storeOAuthToken(
        "calendar",
        tokens.access_token!,
        tokens.refresh_token,
        tokens.expiry_date,
        calendarScopes
      );
      console.log("✓ Google Calendar tokens saved");

      calendarServer.close();
    } catch (err) {
      console.error("Error:", err);
      res.writeHead(500);
      res.end("Error during authentication");
      calendarServer.close();
    }
  });

  calendarServer.listen(3001, () => {
    console.log("📍 Calendar server listening on http://localhost:3001\n");

    const calendarAuthUrl = calendarOauth.generateAuthUrl({
      access_type: "offline",
      scope: calendarScopes,
      prompt: "consent",
    });

    console.log("Google Calendar Authorization URL:");
    console.log(calendarAuthUrl);
    console.log("\nPlease authorize the application to access your Google Calendar.\n");
  });
}

// Run authentication
authenticate().catch((err) => {
  console.error("Fatal error:", err);
  stateStore.close();
  process.exit(1);
});
