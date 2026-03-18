import path from "path";
import fs from "fs";
import {
  ProcessedMessageRecord,
  DigestRecord,
  EmailCategory,
} from "../types/index.js";

/**
 * JSON file-based state store for tracking processed emails, digests, and calendar events
 * (Pure JavaScript alternative to SQLite - no native compilation required)
 */
export class StateStore {
  private dataDir: string;
  private messagesFile: string;
  private digestsFile: string;
  private tokensFile: string;

  constructor() {
    // Use data directory for JSON files
    this.dataDir = path.join(process.cwd(), "data");
    
    // Ensure directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.messagesFile = path.join(this.dataDir, "messages.json");
    this.digestsFile = path.join(this.dataDir, "digests.json");
    this.tokensFile = path.join(this.dataDir, "tokens.json");

    this.initialize();
  }

  private initialize(): void {
    // Initialize JSON files if they don't exist
    if (!fs.existsSync(this.messagesFile)) {
      this.writeJson(this.messagesFile, []);
    }
    if (!fs.existsSync(this.digestsFile)) {
      this.writeJson(this.digestsFile, []);
    }
    if (!fs.existsSync(this.tokensFile)) {
      this.writeJson(this.tokensFile, []);
    }
  }

  private readJson(filePath: string): any {
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    } catch {
      return filePath.includes("messages") ? [] : [];
    }
  }

  private writeJson(filePath: string, data: any): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Record a processed email message
   */
  recordProcessedMessage(record: ProcessedMessageRecord): void {
    const messages = this.readJson(this.messagesFile);
    
    // Remove if exists (update)
    const filtered = messages.filter((m: any) => m.messageId !== record.messageId);
    
    // Add new record
    filtered.push({
      messageId: record.messageId,
      threadId: record.threadId,
      processedAt: record.processedAt.toISOString(),
      category: record.category,
      categoryClusters: record.categoryClusters,
      summarized: record.summarized,
      calendarEventId: record.calendarEventId,
      labelsApplied: record.labelsApplied,
    });
    
    this.writeJson(this.messagesFile, filtered);
  }

  /**
   * Check if a message has been processed
   */
  isMessageProcessed(messageId: string): boolean {
    const messages = this.readJson(this.messagesFile);
    return messages.some((m: any) => m.messageId === messageId);
  }

  /**
   * Get a processed message record
   */
  getProcessedMessage(messageId: string): ProcessedMessageRecord | null {
    const messages = this.readJson(this.messagesFile);
    const msg = messages.find((m: any) => m.messageId === messageId);
    
    if (!msg) return null;

    return {
      messageId: msg.messageId,
      threadId: msg.threadId,
      processedAt: new Date(msg.processedAt),
      category: msg.category as EmailCategory,
      categoryClusters: msg.categoryClusters,
      summarized: msg.summarized,
      calendarEventId: msg.calendarEventId,
      labelsApplied: msg.labelsApplied,
    };
  }

  /**
   * Mark a message as summarized
   */
  markMessageSummarized(messageId: string): void {
    const messages = this.readJson(this.messagesFile);
    const msg = messages.find((m: any) => m.messageId === messageId);
    if (msg) {
      msg.summarized = true;
      this.writeJson(this.messagesFile, messages);
    }
  }

  /**
   * Record a calendar event creation
   */
  recordCalendarEventCreation(messageId: string, eventId: string): void {
    const messages = this.readJson(this.messagesFile);
    const msg = messages.find((m: any) => m.messageId === messageId);
    if (msg) {
      msg.calendarEventId = eventId;
      this.writeJson(this.messagesFile, messages);
    }
  }

  /**
   * Check if a calendar event was already created for a message
   */
  hasCalendarEvent(messageId: string): boolean {
    const messages = this.readJson(this.messagesFile);
    const msg = messages.find((m: any) => m.messageId === messageId);
    return msg && msg.calendarEventId !== null;
  }

  /**
   * Get calendar event ID for a message
   */
  getCalendarEventId(messageId: string): string | null {
    const messages = this.readJson(this.messagesFile);
    const msg = messages.find((m: any) => m.messageId === messageId);
    return msg?.calendarEventId || null;
  }

  /**
   * Record a sent digest
   */
  recordDigest(digest: DigestRecord): void {
    const digests = this.readJson(this.digestsFile);
    
    // Remove if exists (update)
    const filtered = digests.filter((d: any) => d.digestId !== digest.digestId);
    
    // Add new record
    filtered.push({
      digestId: digest.digestId,
      date: digest.date.toISOString(),
      recipient: digest.recipient,
      emailMessageId: digest.emailMessageId,
      messageIds: digest.messageIds,
      createdEventIds: digest.createdEventIds,
      sentAt: digest.sentAt.toISOString(),
    });
    
    this.writeJson(this.digestsFile, filtered);
  }

  /**
   * Get digest for a specific date
   */
  getDigestForDate(date: Date, recipient: string): DigestRecord | null {
    const digests = this.readJson(this.digestsFile);
    
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const digest = digests.find((d: any) => {
      const digestDate = new Date(d.date);
      return (
        digestDate >= startOfDay &&
        digestDate <= endOfDay &&
        d.recipient === recipient
      );
    });

    if (!digest) return null;

    return {
      digestId: digest.digestId,
      date: new Date(digest.date),
      recipient: digest.recipient,
      emailMessageId: digest.emailMessageId,
      messageIds: digest.messageIds,
      createdEventIds: digest.createdEventIds,
      sentAt: new Date(digest.sentAt),
    };
  }

  /**
   * Check if digest exists for a date
   */
  digestExistsForDate(date: Date, recipient: string): boolean {
    return this.getDigestForDate(date, recipient) !== null;
  }

  /**
   * Store OAuth token
   */
  storeOAuthToken(
    account: string,
    accessToken: string,
    refreshToken: string | undefined,
    expireTime: number | undefined,
    scope: string[]
  ): void {
    const tokens = this.readJson(this.tokensFile);
    
    // Remove if exists (update)
    const filtered = tokens.filter((t: any) => t.account !== account);
    
    // Add new token
    filtered.push({
      account,
      accessToken,
      refreshToken,
      expireTime,
      scope,
      updatedAt: new Date().toISOString(),
    });
    
    this.writeJson(this.tokensFile, filtered);
  }

  /**
   * Retrieve OAuth token
   */
  getOAuthToken(account: string): {
    accessToken: string;
    refreshToken?: string;
    expireTime?: number;
    scope: string[];
  } | null {
    const tokens = this.readJson(this.tokensFile);
    const token = tokens.find((t: any) => t.account === account);

    if (!token) return null;

    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expireTime: token.expireTime,
      scope: token.scope,
    };
  }

  /**
   * Get all processed messages in a date range
   */
  getProcessedMessagesByDateRange(
    startDate: Date,
    endDate: Date
  ): ProcessedMessageRecord[] {
    const messages = this.readJson(this.messagesFile);

    return messages
      .filter((m: any) => {
        const msgDate = new Date(m.processedAt);
        return msgDate >= startDate && msgDate <= endDate;
      })
      .sort(
        (a: any, b: any) =>
          new Date(b.processedAt).getTime() -
          new Date(a.processedAt).getTime()
      )
      .map((m: any) => ({
        messageId: m.messageId,
        threadId: m.threadId,
        processedAt: new Date(m.processedAt),
        category: m.category as EmailCategory,
        categoryClusters: m.categoryClusters,
        summarized: m.summarized,
        calendarEventId: m.calendarEventId,
        labelsApplied: m.labelsApplied,
      }));
  }

  /**
   * Close database connection (no-op for JSON store)
   */
  close(): void {
    // JSON store doesn't need explicit closing
  }
}
