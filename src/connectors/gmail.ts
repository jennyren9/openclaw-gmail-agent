import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { GmailMessage } from "../types/index.js";
import { StateStore } from "../core/state_store.js";

/**
 * Gmail connector for reading emails, managing labels, and sending messages
 */
export class GmailConnector {
  private oauth2Client: OAuth2Client;
  private gmail = google.gmail("v1");
  private stateStore: StateStore;

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    stateStore: StateStore,
    accessToken?: string,
    refreshToken?: string
  ) {
    this.oauth2Client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri,
    });

    if (accessToken) {
      this.oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
    }

    this.stateStore = stateStore;
  }

  /**
   * Get the OAuth2 authorization URL
   */
  getAuthorizationUrl(): string {
    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
    });
  }

  /**
   * Handle OAuth callback and get access token
   */
  async handleAuthCallback(code: string): Promise<void> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    // Store tokens
    const scope = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ];
    this.stateStore.storeOAuthToken(
      "gmail",
      tokens.access_token!,
      tokens.refresh_token,
      tokens.expiry_date,
      scope
    );
  }

  /**
   * Refresh access token if needed
   */
  async ensureValidToken(): Promise<void> {
    const credentials = this.oauth2Client.credentials;
    if (!credentials.expiry_date || credentials.expiry_date > Date.now()) {
      // Token is still valid or no expiry info
      return;
    }

    // Refresh the token
    const { credentials: newCredentials } =
      await this.oauth2Client.refreshAccessToken();
    this.oauth2Client.setCredentials(newCredentials);

    // Update stored token
    const scope = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ];
    this.stateStore.storeOAuthToken(
      "gmail",
      newCredentials.access_token!,
      newCredentials.refresh_token,
      newCredentials.expiry_date,
      scope
    );
  }

  /**
   * Read recent emails from the inbox
   */
  async readInboxEmails(lookbackHours: number = 24): Promise<GmailMessage[]> {
    await this.ensureValidToken();

    const lookbackTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    const query = `in:inbox after:${Math.floor(lookbackTime.getTime() / 1000)}`;

    const messageListRes = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
    });

    const messages = messageListRes.data.messages || [];
    const emails: GmailMessage[] = [];

    for (const message of messages) {
      try {
        const email = await this.getMessageDetails(message.id!);
        if (email) {
          emails.push(email);
        }
      } catch (err) {
        console.error(`Error fetching message ${message.id}:`, err);
      }
    }

    return emails;
  }

  /**
   * Get detailed information about a single message
   */
  private async getMessageDetails(messageId: string): Promise<GmailMessage | null> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const message = res.data;
    if (!message.payload?.headers) {
      return null;
    }

    const headers = message.payload.headers;
    const getHeader = (name: string): string => {
      const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
      return header?.value || "";
    };

    const from = getHeader("from");
    const subject = getHeader("subject");
    const receivedStr = getHeader("date");
    const to = getHeader("to")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const cc = getHeader("cc")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let body = "";
    let hasIcsAttachment = false;

    if (message.payload.parts) {
      for (const part of message.payload.parts) {
        if (part.mimeType === "text/plain" || part.mimeType === "text/html") {
          if (part.body?.data) {
            body = Buffer.from(part.body.data, "base64").toString("utf-8");
            break;
          }
        }
        if (part.mimeType === "application/ics" ||
            part.filename?.endsWith(".ics")) {
          hasIcsAttachment = true;
        }
      }
    } else if (message.payload.body?.data) {
      body = Buffer.from(message.payload.body.data, "base64").toString("utf-8");
    }

    const snippet = message.snippet || body.substring(0, 200);
    const hasInvitation = message.payload.mimeType?.includes("multipart/alternative") &&
      (body.includes("BEGIN:VCALENDAR") ||
       getHeader("content-type").includes("text/calendar") ||
       hasIcsAttachment);

    return {
      id: messageId,
      threadId: message.threadId!,
      from,
      to,
      cc,
      subject,
      snippet,
      body,
      receivedTime: new Date(receivedStr || Date.now()),
      labels: message.labelIds || [],
      hasInvitation,
      hasIcsAttachment,
      mimeType: message.payload.mimeType,
      headers: Object.fromEntries(headers.map((h) => [h.name!, h.value!])),
    };
  }

  /**
   * Create Gmail label if it doesn't exist
   */
  async createOrGetLabel(labelName: string): Promise<string> {
    try {
      const listRes = await this.gmail.users.labels.list({
        userId: "me",
      });

      const existingLabel = listRes.data.labels?.find(
        (l) => l.name === labelName
      );

      if (existingLabel) {
        return existingLabel.id!;
      }

      const createRes = await this.gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });

      return createRes.data.id!;
    } catch (err) {
      console.error(`Error managing label ${labelName}:`, err);
      throw err;
    }
  }

  /**
   * Apply label to a message
   */
  async applyLabel(messageId: string, labelId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
      },
    });
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: ["UNREAD"],
      },
    });
  }

  /**
   * Mark a message as unread
   */
  async markAsUnread(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: ["UNREAD"],
      },
    });
  }

  /**
   * Send an email
   */
  async sendEmail(
    to: string,
    subject: string,
    body: string,
    isHtml: boolean = true
  ): Promise<string> {
    await this.ensureValidToken();

    const message = [
      `From: me`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/${isHtml ? "html" : "plain"}; charset=utf-8`,
      "",
      body,
    ].join("\n");

    const encodedMessage = Buffer.from(message)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
      },
    });

    return res.data.id!;
  }

  /**
   * Get a thread's messages
   */
  async getThreadMessages(threadId: string): Promise<GmailMessage[]> {
    const res = await this.gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "full",
    });

    const thread = res.data;
    const result: GmailMessage[] = [];

    if (thread.messages) {
      for (const message of thread.messages) {
        if (message.id) {
          const email = await this.getMessageDetails(message.id);
          if (email) {
            result.push(email);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get message headers by ID
   */
  async getMessageHeaders(messageId: string): Promise<Record<string, string>> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date", "To", "Cc"],
    });

    const headers = res.data.payload?.headers || [];
    return Object.fromEntries(
      headers.map((h) => [h.name!, h.value!])
    );
  }
}
