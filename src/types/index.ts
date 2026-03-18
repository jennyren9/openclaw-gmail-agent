/**
 * Core types for the OpenClaw Gmail Agent
 */

/**
 * Email classification categories
 */
export enum EmailCategory {
  NEEDS_ACTION = "needs_action",
  IMPORTANT_FYI = "important_fyi",
  INVITE_OR_TIME_SENSITIVE = "invite_or_time_sensitive",
  LOW_PRIORITY = "low_priority",
}

/**
 * Represents a Gmail message
 */
export interface GmailMessage {
  id: string; // Gmail message ID
  threadId: string; // Gmail thread ID
  from: string; // Sender email
  to: string[]; // Recipient emails
  cc?: string[]; // CC recipients
  subject: string;
  snippet: string; // Short preview
  body?: string; // Full body text (when fetched)
  receivedTime: Date;
  labels: string[]; // Gmail labels
  hasInvitation: boolean; // Calendar invitation metadata
  hasIcsAttachment: boolean; // ICS file attached
  mimeType?: string;
  headers?: Record<string, string>;
}

/**
 * Classification result for an email
 */
export interface ClassificationResult {
  messageId: string;
  category: EmailCategory;
  confidence: number; // 0-1
  reason: string;
  extractedDeadline?: Date; // If time-sensitive
  senderTrusted?: boolean; // For calendar creation decisions
}

/**
 * Extracted event from email
 */
export interface ExtractedEvent {
  messageId: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  timezone: string;
  location?: string;
  confidence: number; // 0-1
  icsData?: string; // Raw ICS if available
}

/**
 * Summary item in the daily digest
 */
export interface DigestItem {
  messageId: string;
  from: string;
  subject: string;
  receivedTime: Date;
  category: EmailCategory;
  summary: string; // 1-2 sentence summary
  recommendedAction?: string;
  extractedEvent?: ExtractedEvent;
}

/**
 * Daily digest email content
 */
export interface DailyDigest {
  digestId: string;
  date: Date;
  needsAction: DigestItem[];
  invitesAndTimeSensitive: DigestItem[];
  importantFyi: DigestItem[];
  lowPrioritySkippedCount: number;
  totalEmailsProcessed: number;
  createdCalendarEventIds: string[];
}

/**
 * Processing state tracking
 */
export interface ProcessedMessageRecord {
  messageId: string;
  threadId: string;
  processedAt: Date;
  category: EmailCategory;
  categoryClusters?: string[]; // For grouping similar messages
  summarized: boolean;
  calendarEventId?: string;
  labelsApplied: string[];
}

/**
 * Digest tracking for deduplication
 */
export interface DigestRecord {
  digestId: string;
  date: Date;
  recipient: string;
  emailMessageId?: string; // Gmail ID of the sent summary email
  messageIds: string[]; // IDs of emails included
  createdEventIds: string[]; // Calendar events created
  sentAt: Date;
}

/**
 * OAuth credentials storage
 */
export interface OAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expireTime?: number;
  scope: string[];
}

/**
 * Configuration for the agent
 */
export interface AgentConfig {
  // Gmail settings
  primaryGmailAccount: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  
  // Digest settings
  digestRecipient: string;
  digestSchedule: string; // Cron expression
  digestTimezone: string;
  emailLookbackHours: number;
  
  // Database
  databasePath: string;
  
  // Feature flags
  markLowPriorityAsRead: boolean;
  markFyiAsReadAfterDigest: boolean;
  markActionItemsAsRead: boolean;
  dryRun: boolean;
  
  // API keys (optional, for future AI features)
  openaiApiKey?: string;
  claudeApiKey?: string;
}

/**
 * Sender trust configuration
 */
export interface TrustedSender {
  email?: string;
  domain?: string;
  displayName?: string;
  alwaysCreateCalendarEvent?: boolean;
  neverCreateCalendarEvent?: boolean;
}

/**
 * Summary model for AI-based summarization (for future use)
 */
export interface SummarizationModel {
  summarizeEmail(content: string, subject: string): Promise<string>;
  summarizeMultiple(
    items: GmailMessage[],
    category: EmailCategory
  ): Promise<string>;
}

/**
 * Classification model for AI-based classification (for future use)
 */
export interface ClassificationModel {
  classify(email: GmailMessage): Promise<ClassificationResult>;
}
