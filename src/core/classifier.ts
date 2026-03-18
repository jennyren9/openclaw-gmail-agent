import { GmailMessage, EmailCategory, ClassificationResult } from "../types/index.js";

/**
 * Email classifier using conservative heuristics
 */
export class EmailClassifier {
  /**
   * Classify an email into one of four categories
   */
  classify(email: GmailMessage): ClassificationResult {
    // Check for invitations first (highest priority)
    if (this.isInviteOrTimeSensitive(email)) {
      return {
        messageId: email.id,
        category: EmailCategory.INVITE_OR_TIME_SENSITIVE,
        confidence: 0.9,
        reason: "Contains calendar invitation or time-sensitive event",
        extractedDeadline: this.extractDeadline(email),
        senderTrusted: this.isTrustedSender(email.from),
      };
    }

    // Check for action required
    if (this.needsAction(email)) {
      return {
        messageId: email.id,
        category: EmailCategory.NEEDS_ACTION,
        confidence: this.calculateActionConfidence(email),
        reason: this.getActionReason(email),
        senderTrusted: this.isTrustedSender(email.from),
      };
    }

    // Check for low priority
    if (this.isLowPriority(email)) {
      return {
        messageId: email.id,
        category: EmailCategory.LOW_PRIORITY,
        confidence: this.calculateLowPriorityConfidence(email),
        reason: this.getLowPriorityReason(email),
      };
    }

    // Default to important FYI
    return {
      messageId: email.id,
      category: EmailCategory.IMPORTANT_FYI,
      confidence: 0.6,
      reason: "Important update or information",
    };
  }

  private isInviteOrTimeSensitive(email: GmailMessage): boolean {
    const subject = email.subject.toLowerCase();
    const body = (email.body || "").toLowerCase();
    const snippet = (email.snippet || "").toLowerCase();

    const inviteKeywords = [
      "invitation",
      "invite",
      "meeting",
      "conference",
      "webinar",
      "calendar invite",
      "you are invited",
      "attending?",
      "rsvp",
      "accept or decline",
      "calendar event",
      "appointment",
    ];

    const timeKeywords = [
      "deadline",
      "due date",
      "expires",
      "ends in",
      "limited time",
      "today",
      "tomorrow",
      "urgent",
      "asap",
      "immediately",
    ];

    // Check for invitation metadata
    if (email.hasInvitation || email.hasIcsAttachment) {
      return true;
    }

    // Check subject and body for invite keywords
    const hasInvite = inviteKeywords.some(
      (kw) =>
        subject.includes(kw) ||
        body.includes(kw) ||
        snippet.includes(kw)
    );

    // Check for time-sensitive keywords
    const hasUrgency =
      timeKeywords.some((kw) => body.includes(kw) || subject.includes(kw)) &&
      !this.isNewsletter(email);

    return hasInvite || hasUrgency;
  }

  private needsAction(email: GmailMessage): boolean {
    const subject = email.subject.toLowerCase();
    const body = (email.body || "").toLowerCase();
    const snippet = (email.snippet || "").toLowerCase();
    const from = email.from.toLowerCase();

    const actionKeywords = [
      "please review",
      "approval needed",
      "approve",
      "reject",
      "request",
      "awaiting your",
      "your response",
      "reply",
      "action required",
      "follow up",
      "feedback",
      "suggestion",
      "todo",
      "billing",
      "payment",
      "invoice",
      "receipt",
      "confirmation",
      "verify",
      "confirm",
      "update required",
      "account alert",
      "action needed",
    ];

    const hasActionKeyword = actionKeywords.some(
      (kw) =>
        subject.includes(kw) ||
        body.includes(kw) ||
        snippet.includes(kw)
    );

    // Check for direct addressing
    const isDirect =
      subject.includes("you") ||
      subject.includes("your") ||
      body.substring(0, 500).match(/^[^:]*you[^:]*:/i);

    // Check if it's from a service account (likely needs action)
    const isServiceEmail = from.includes("@") &&
      (from.includes("noreply") ||
       from.includes("support") ||
       from.includes("no-reply") ||
       from.includes("billing") ||
       from.includes("security"));

    return hasActionKeyword || (isDirect && !this.isNewsletter(email)) || isServiceEmail;
  }

  private isLowPriority(email: GmailMessage): boolean {
    const subject = email.subject.toLowerCase();
    const from = email.from.toLowerCase();

    const lowPriorityPatterns = [
      /newsletter/i,
      /unsubscribe/i,
      /promotional/i,
      /promo/i,
      /sale/i,
      /offer/i,
      /coupon/i,
      /deal/i,
      /social.*update/i,
      /facebook.*notif/i,
      /twitter.*notif/i,
      /instagram.*notif/i,
      /linkedin.*notif/i,
      /github.*notif/i,
      /stackoverflow.*notif/i,
    ];

    // Newsletter indicators
    if (this.isNewsletter(email)) {
      return true;
    }

    // Promotional content
    if (lowPriorityPatterns.some((pattern) => pattern.test(subject))) {
      return true;
    }

    // Social media and common automated services
    const autoDomains = [
      "notifications@",
      "alerts@",
      "noreply@",
      "feedback@",
      "do-not-reply@",
    ];

    if (autoDomains.some((domain) => from.includes(domain))) {
      return true;
    }

    // Check for bulk email indicators
    const bulkKeywords = ["unsubscribe", "list-unsubscribe", "bulk"];
    const bodyText = email.body || "";
    if (bulkKeywords.some((kw) => bodyText.toLowerCase().includes(kw))) {
      return true;
    }

    return false;
  }

  private isNewsletter(email: GmailMessage): boolean {
    const subject = email.subject.toLowerCase();
    const from = email.from.toLowerCase();

    const newsletterIndicators = [
      /newsletter/i,
      /update.*digest/i,
      /weekly/i,
      /monthly/i,
      /daily.*summary/i,
      /digest/i,
    ];

    return (
      newsletterIndicators.some((pattern) => pattern.test(subject)) ||
      from.includes("newsletter") ||
      from.includes("digest")
    );
  }

  private calculateActionConfidence(email: GmailMessage): number {
    let confidence = 0.7;

    // Increase confidence if multiple factors present
    const body = (email.body || "").toLowerCase();
    const actionKeywords = [
      "please",
      "urgent",
      "asap",
      "immediately",
      "must",
    ];

    const count = actionKeywords.filter((kw) => body.includes(kw)).length;
    confidence += count * 0.05;

    return Math.min(confidence, 0.95);
  }

  private calculateLowPriorityConfidence(email: GmailMessage): number {
    if (this.isNewsletter(email)) {
      return 0.95;
    }
    return 0.85;
  }

  private getActionReason(email: GmailMessage): string {
    const subject = email.subject.toLowerCase();

    if (subject.includes("approval") || subject.includes("approve")) {
      return "Approval or decision needed";
    }
    if (subject.includes("billing") || subject.includes("payment")) {
      return "Billing or payment action required";
    }
    if (subject.includes("verification") || subject.includes("confirm")) {
      return "Account verification or confirmation needed";
    }
    if (subject.includes("follow up") || subject.includes("reminder")) {
      return "Follow-up or reminder";
    }

    return "Direct request or action required";
  }

  private getLowPriorityReason(email: GmailMessage): string {
    if (this.isNewsletter(email)) {
      return "Newsletter or digest";
    }

    const subject = email.subject.toLowerCase();
    if (
      subject.includes("sale") ||
      subject.includes("promo") ||
      subject.includes("offer")
    ) {
      return "Promotional content";
    }

    if (
      subject.includes("notification") ||
      subject.includes("social") ||
      subject.includes("alert")
    ) {
      return "Social media or automated notification";
    }

    return "Low priority automated message";
  }

  private extractDeadline(email: GmailMessage): Date | undefined {
    const body = email.body || "";
    const subject = email.subject;

    // Look for date patterns
    const datePatterns = [
      /by\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /due\s+(\w+\s+\d{1,2})/i,
      /deadline.*?(\w+\s+\d{1,2})/i,
    ];

    for (const pattern of datePatterns) {
      const match = body.match(pattern) || subject.match(pattern);
      if (match && match[1]) {
        try {
          const date = new Date(match[1]);
          if (!isNaN(date.getTime())) {
            return date;
          }
        } catch {
          // Continue searching
        }
      }
    }

    return undefined;
  }

  private isTrustedSender(from: string): boolean {
    const trustedDomains = [
      "gmail.com",
      "google.com",
      "company.com", // Replace with actual company domain
      "github.com",
      "stripe.com",
      "aws.amazon.com",
    ];

    const domain = from.split("@")[1]?.toLowerCase();
    return domain ? trustedDomains.some((d) => domain.includes(d)) : false;
  }
}
