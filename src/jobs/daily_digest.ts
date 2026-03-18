import { DateTime } from "luxon";
import {
  EmailCategory,
  DailyDigest,
  DigestRecord,
  ProcessedMessageRecord,
} from "../types/index.js";
import { GmailConnector } from "../connectors/gmail.js";
import { CalendarConnector } from "../connectors/calendar.js";
import { StateStore } from "../core/state_store.js";
import { EmailClassifier } from "../core/classifier.js";
import { EmailSummarizer } from "../core/summarizer.js";
import { EventExtractor } from "../core/event_extractor.js";
import { AgentConfig } from "../types/index.js";

/**
 * Main daily digest job
 */
export class DailyDigestJob {
  private config: AgentConfig;
  private gmail: GmailConnector;
  private calendar: CalendarConnector;
  private stateStore: StateStore;
  private classifier = new EmailClassifier();
  private summarizer = new EmailSummarizer();
  private eventExtractor = new EventExtractor();

  constructor(
    config: AgentConfig,
    gmail: GmailConnector,
    calendar: CalendarConnector,
    stateStore: StateStore
  ) {
    this.config = config;
    this.gmail = gmail;
    this.calendar = calendar;
    this.stateStore = stateStore;
  }

  /**
   * Run the daily digest job
   */
  async run(dryRun: boolean = false): Promise<DailyDigest> {
    console.log(`[DIGEST] Starting daily digest job (dry_run=${dryRun})`);

    // Parse today's date in configured timezone
    const today = DateTime.now().setZone(this.config.digestTimezone);
    const digestDate = today.toJSDate();

    // Check if digest already exists for today
    const existingDigest = this.stateStore.getDigestForDate(
      digestDate,
      this.config.digestRecipient
    );
    if (existingDigest && !dryRun) {
      console.log("[DIGEST] Digest already sent for today");
      return {
        digestId: existingDigest.digestId,
        date: existingDigest.date,
        needsAction: [],
        invitesAndTimeSensitive: [],
        importantFyi: [],
        lowPrioritySkippedCount: 0,
        totalEmailsProcessed: 0,
        createdCalendarEventIds: [],
      };
    }

    // Read emails from the last 24 hours
    console.log("[DIGEST] Reading emails from the last 24 hours...");
    const emails = await this.gmail.readInboxEmails(
      this.config.emailLookbackHours
    );

    console.log(`[DIGEST] Found ${emails.length} emails to process`);

    // Process emails
    const needsActionItems = [];
    const inviteItems = [];
    const fyyItems = [];
    let lowPriorityCount = 0;
    const createdEventIds: string[] = [];
    const processedMessageIds: string[] = [];

    // Create labels if they don't exist
    if (!dryRun) {
      await this.ensureLabels();
    }

    for (const email of emails) {
      // Skip if already processed today
      if (this.stateStore.isMessageProcessed(email.id)) {
        continue;
      }

      processedMessageIds.push(email.id);

      // Classify email
      const classification = this.classifier.classify(email);
      console.log(
        `[DIGEST] Classified ${email.id}: ${classification.category}`
      );

      // Generate digest item
      const digestItem = this.summarizer.generateDigestItem(email, classification.category);

      // Handle based on category
      switch (classification.category) {
        case EmailCategory.NEEDS_ACTION:
          needsActionItems.push(digestItem);
          break;

        case EmailCategory.INVITE_OR_TIME_SENSITIVE:
          inviteItems.push(digestItem);

          // Try to extract and create calendar event
          if (!dryRun) {
            await this.createCalendarEventIfNeeded(
              email,
              createdEventIds
            );
          }
          break;

        case EmailCategory.IMPORTANT_FYI:
          fyyItems.push(digestItem);
          break;

        case EmailCategory.LOW_PRIORITY:
          lowPriorityCount++;

          // Mark as read if configured
          if (this.config.markLowPriorityAsRead && !dryRun) {
            await this.gmail.markAsRead(email.id);
          }
          break;
      }

      // Record in state if not dry run
      if (!dryRun) {
        const processed: ProcessedMessageRecord = {
          messageId: email.id,
          threadId: email.threadId,
          processedAt: new Date(),
          category: classification.category,
          summarized: [
            EmailCategory.NEEDS_ACTION,
            EmailCategory.INVITE_OR_TIME_SENSITIVE,
            EmailCategory.IMPORTANT_FYI,
          ].includes(classification.category),
          labelsApplied: [],
        };

        this.stateStore.recordProcessedMessage(processed);
        
        // Apply category labels
        await this.applyLabelsToMessage(
          email.id,
          classification.category,
          processed
        );
      }
    }

    // Generate digest
    const digestId = `digest_${today.toFormat("yyyy-MM-dd")}`;
    const totalProcessed = processedMessageIds.length;

    const digest: DailyDigest = {
      digestId,
      date: digestDate,
      needsAction: needsActionItems,
      invitesAndTimeSensitive: inviteItems,
      importantFyi: fyyItems,
      lowPrioritySkippedCount: lowPriorityCount,
      totalEmailsProcessed: totalProcessed,
      createdCalendarEventIds: createdEventIds,
    };

    // Send digest email
    if (totalProcessed > 0) {
      const html = this.summarizer.generateDigestHtml(
        needsActionItems,
        inviteItems,
        fyyItems,
        lowPriorityCount,
        totalProcessed
      );

      const subject = `Daily Inbox Summary — ${today.toFormat("yyyy-MM-dd")}`;

      if (dryRun) {
        console.log("[DIGEST] DRY RUN - Would send digest email:");
        console.log(`  Subject: ${subject}`);
        console.log(`  To: ${this.config.digestRecipient}`);
        console.log(`  Items: ${totalProcessed}`);
      } else {
        console.log("[DIGEST] Sending digest email...");
        const messageId = await this.gmail.sendEmail(
          this.config.digestRecipient,
          subject,
          html,
          true
        );

        // Record digest in state
        const digestRecord: DigestRecord = {
          digestId,
          date: digestDate,
          recipient: this.config.digestRecipient,
          emailMessageId: messageId,
          messageIds: processedMessageIds,
          createdEventIds,
          sentAt: new Date(),
        };

        this.stateStore.recordDigest(digestRecord);
        console.log("[DIGEST] Digest sent successfully");
      }
    } else {
      console.log("[DIGEST] No emails to summarize");
    }

    console.log("[DIGEST] Job completed");
    return digest;
  }

  private async ensureLabels(): Promise<void> {
    const labelNames = [
      "OpenClaw/Needs Action",
      "OpenClaw/Important FYI",
      "OpenClaw/Invite",
      "OpenClaw/Low Priority",
      "OpenClaw/Summarized",
      "OpenClaw/Calendared",
    ];

    for (const labelName of labelNames) {
      try {
        await this.gmail.createOrGetLabel(labelName);
      } catch (err) {
        console.error(`Failed to create label ${labelName}:`, err);
      }
    }
  }

  private async applyLabelsToMessage(
    messageId: string,
    category: EmailCategory,
    record: ProcessedMessageRecord
  ): Promise<void> {
    const categoryLabelMap: Record<EmailCategory, string> = {
      [EmailCategory.NEEDS_ACTION]: "OpenClaw/Needs Action",
      [EmailCategory.IMPORTANT_FYI]: "OpenClaw/Important FYI",
      [EmailCategory.INVITE_OR_TIME_SENSITIVE]: "OpenClaw/Invite",
      [EmailCategory.LOW_PRIORITY]: "OpenClaw/Low Priority",
    };

    const categoryLabelName = categoryLabelMap[category];
    const categoryLabel = await this.gmail.createOrGetLabel(categoryLabelName);

    try {
      await this.gmail.applyLabel(messageId, categoryLabel);
      record.labelsApplied.push(categoryLabel);

      // Also apply Summarized label
      const summarizedLabel = await this.gmail.createOrGetLabel(
        "OpenClaw/Summarized"
      );
      await this.gmail.applyLabel(messageId, summarizedLabel);
      record.labelsApplied.push(summarizedLabel);
    } catch (err) {
      console.error(`Failed to apply labels to ${messageId}:`, err);
    }
  }

  private async createCalendarEventIfNeeded(
    email: any,
    createdEventIds: string[]
  ): Promise<void> {
    // Skip if calendar event already created
    if (this.stateStore.hasCalendarEvent(email.id)) {
      console.log(`[DIGEST] Calendar event already created for ${email.id}`);
      return;
    }

    // Extract event from email
    const extractedEvent = this.eventExtractor.extractEvent(email);

    if (!extractedEvent) {
      console.log(
        `[DIGEST] Could not extract calendar event from ${email.id}`
      );
      return;
    }

    // Check confidence threshold
    if (extractedEvent.confidence < 0.75) {
      console.log(
        `[DIGEST] Event confidence too low (${extractedEvent.confidence}) for ${email.id}`
      );
      return;
    }

    // Create event
    try {
      const eventId = await this.calendar.createEvent(extractedEvent);
      console.log(
        `[DIGEST] Created calendar event ${eventId} for ${email.id}`
      );

      createdEventIds.push(eventId);
      this.stateStore.recordCalendarEventCreation(email.id, eventId);

      // Apply Calendared label
      const calendaredLabel = await this.gmail.createOrGetLabel(
        "OpenClaw/Calendared"
      );
      await this.gmail.applyLabel(email.id, calendaredLabel);
    } catch (err) {
      console.error(
        `Failed to create calendar event for ${email.id}:`,
        err
      );
    }
  }

  /**
   * Generate and display digest preview without sending
   */
  async previewDigest(): Promise<string> {
    console.log("[PREVIEW] Generating digest preview...");

    const emails = await this.gmail.readInboxEmails(
      this.config.emailLookbackHours
    );
    console.log(`[PREVIEW] Found ${emails.length} emails`);

    const needsActionItems = [];
    const inviteItems = [];
    const fyyItems = [];
    let lowPriorityCount = 0;
    let totalProcessed = 0;

    for (const email of emails) {
      // Skip if already processed
      if (this.stateStore.isMessageProcessed(email.id)) {
        continue;
      }

      totalProcessed++;

      const classification = this.classifier.classify(email);
      const digestItem = this.summarizer.generateDigestItem(email, classification.category);

      switch (classification.category) {
        case EmailCategory.NEEDS_ACTION:
          needsActionItems.push(digestItem);
          break;
        case EmailCategory.INVITE_OR_TIME_SENSITIVE:
          inviteItems.push(digestItem);
          break;
        case EmailCategory.IMPORTANT_FYI:
          fyyItems.push(digestItem);
          break;
        case EmailCategory.LOW_PRIORITY:
          lowPriorityCount++;
          break;
      }
    }

    return this.summarizer.generateDigestHtml(
      needsActionItems,
      inviteItems,
      fyyItems,
      lowPriorityCount,
      totalProcessed
    );
  }
}
