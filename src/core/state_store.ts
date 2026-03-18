import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import {
  ProcessedMessageRecord,
  DigestRecord,
  EmailCategory,
} from "./types/index.js";

/**
 * SQLite-based state store for tracking processed emails, digests, and calendar events
 */
export class StateStore {
  private db: Database.Database;

  constructor(databasePath: string) {
    // Ensure directory exists
    const dir = path.dirname(databasePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize(): void {
    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT UNIQUE NOT NULL,
        threadId TEXT NOT NULL,
        processedAt INTEGER NOT NULL,
        category TEXT NOT NULL,
        categoryClusters TEXT,
        summarized INTEGER DEFAULT 0,
        calendarEventId TEXT,
        labelsApplied TEXT
      );

      CREATE TABLE IF NOT EXISTS digests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        digestId TEXT UNIQUE NOT NULL,
        date INTEGER NOT NULL,
        recipient TEXT NOT NULL,
        emailMessageId TEXT,
        messageIds TEXT NOT NULL,
        createdEventIds TEXT,
        sentAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account TEXT UNIQUE NOT NULL,
        accessToken TEXT NOT NULL,
        refreshToken TEXT,
        expireTime INTEGER,
        scope TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_processed_messages_messageId 
        ON processed_messages(messageId);
      CREATE INDEX IF NOT EXISTS idx_processed_messages_threadId 
        ON processed_messages(threadId);
      CREATE INDEX IF NOT EXISTS idx_digests_date 
        ON digests(date);
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_account 
        ON oauth_tokens(account);
    `);
  }

  /**
   * Record a processed email message
   */
  recordProcessedMessage(record: ProcessedMessageRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO processed_messages
      (messageId, threadId, processedAt, category, categoryClusters, summarized, calendarEventId, labelsApplied)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.messageId,
      record.threadId,
      record.processedAt.getTime(),
      record.category,
      record.categoryClusters ? JSON.stringify(record.categoryClusters) : null,
      record.summarized ? 1 : 0,
      record.calendarEventId || null,
      JSON.stringify(record.labelsApplied)
    );
  }

  /**
   * Check if a message has been processed
   */
  isMessageProcessed(messageId: string): boolean {
    const stmt = this.db.prepare(
      "SELECT 1 FROM processed_messages WHERE messageId = ?"
    );
    return stmt.get(messageId) !== undefined;
  }

  /**
   * Get a processed message record
   */
  getProcessedMessage(messageId: string): ProcessedMessageRecord | null {
    const stmt = this.db.prepare(
      "SELECT * FROM processed_messages WHERE messageId = ?"
    );
    const row = stmt.get(messageId) as any;
    if (!row) return null;

    return {
      messageId: row.messageId,
      threadId: row.threadId,
      processedAt: new Date(row.processedAt),
      category: row.category as EmailCategory,
      categoryClusters: row.categoryClusters
        ? JSON.parse(row.categoryClusters)
        : undefined,
      summarized: row.summarized === 1,
      calendarEventId: row.calendarEventId,
      labelsApplied: JSON.parse(row.labelsApplied),
    };
  }

  /**
   * Mark a message as summarized
   */
  markMessageSummarized(messageId: string): void {
    const stmt = this.db.prepare(
      "UPDATE processed_messages SET summarized = 1 WHERE messageId = ?"
    );
    stmt.run(messageId);
  }

  /**
   * Record a calendar event creation
   */
  recordCalendarEventCreation(messageId: string, eventId: string): void {
    const stmt = this.db.prepare(
      "UPDATE processed_messages SET calendarEventId = ? WHERE messageId = ?"
    );
    stmt.run(eventId, messageId);
  }

  /**
   * Check if a calendar event was already created for a message
   */
  hasCalendarEvent(messageId: string): boolean {
    const stmt = this.db.prepare(
      "SELECT calendarEventId FROM processed_messages WHERE messageId = ?"
    );
    const row = stmt.get(messageId) as any;
    return row && row.calendarEventId !== null;
  }

  /**
   * Get calendar event ID for a message
   */
  getCalendarEventId(messageId: string): string | null {
    const stmt = this.db.prepare(
      "SELECT calendarEventId FROM processed_messages WHERE messageId = ?"
    );
    const row = stmt.get(messageId) as any;
    return row?.calendarEventId || null;
  }

  /**
   * Record a sent digest
   */
  recordDigest(digest: DigestRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO digests
      (digestId, date, recipient, emailMessageId, messageIds, createdEventIds, sentAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      digest.digestId,
      digest.date.getTime(),
      digest.recipient,
      digest.emailMessageId || null,
      JSON.stringify(digest.messageIds),
      JSON.stringify(digest.createdEventIds),
      digest.sentAt.getTime()
    );
  }

  /**
   * Get digest for a specific date
   */
  getDigestForDate(date: Date, recipient: string): DigestRecord | null {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const stmt = this.db.prepare(
      "SELECT * FROM digests WHERE date >= ? AND date <= ? AND recipient = ?"
    );
    const row = stmt.get(
      startOfDay.getTime(),
      endOfDay.getTime(),
      recipient
    ) as any;

    if (!row) return null;

    return {
      digestId: row.digestId,
      date: new Date(row.date),
      recipient: row.recipient,
      emailMessageId: row.emailMessageId,
      messageIds: JSON.parse(row.messageIds),
      createdEventIds: JSON.parse(row.createdEventIds),
      sentAt: new Date(row.sentAt),
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
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO oauth_tokens
      (account, accessToken, refreshToken, expireTime, scope, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      account,
      accessToken,
      refreshToken || null,
      expireTime || null,
      JSON.stringify(scope),
      Date.now()
    );
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
    const stmt = this.db.prepare("SELECT * FROM oauth_tokens WHERE account = ?");
    const row = stmt.get(account) as any;

    if (!row) return null;

    return {
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expireTime: row.expireTime,
      scope: JSON.parse(row.scope),
    };
  }

  /**
   * Get all processed messages in a date range
   */
  getProcessedMessagesByDateRange(
    startDate: Date,
    endDate: Date
  ): ProcessedMessageRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM processed_messages
      WHERE processedAt >= ? AND processedAt <= ?
      ORDER BY processedAt DESC
    `);

    const rows = stmt.all(
      startDate.getTime(),
      endDate.getTime()
    ) as any[];

    return rows.map((row) => ({
      messageId: row.messageId,
      threadId: row.threadId,
      processedAt: new Date(row.processedAt),
      category: row.category as EmailCategory,
      categoryClusters: row.categoryClusters
        ? JSON.parse(row.categoryClusters)
        : undefined,
      summarized: row.summarized === 1,
      calendarEventId: row.calendarEventId,
      labelsApplied: JSON.parse(row.labelsApplied),
    }));
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
