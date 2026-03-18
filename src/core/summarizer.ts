import { GmailMessage, EmailCategory, DigestItem } from "../types/index.js";

/**
 * Email summarizer that generates concise summaries for the daily digest
 */
export class EmailSummarizer {
  /**
   * Generate a digest item from an email
   */
  generateDigestItem(
    email: GmailMessage,
    category: EmailCategory
  ): DigestItem {
    const summary = this.generateSummary(email);
    const recommendedAction = this.getRecommendedAction(email, category);

    return {
      messageId: email.id,
      from: this.formatSender(email.from),
      subject: email.subject,
      receivedTime: email.receivedTime,
      category,
      summary,
      recommendedAction,
    };
  }

  /**
   * Generate a 1-2 sentence summary from an email
   */
  private generateSummary(email: GmailMessage): string {
    let summary = email.snippet;

    // Clean up the snippet
    if (summary) {
      summary = summary
        .replace(/<[^>]*>/g, "") // Remove HTML tags
        .replace(/&quot;/g, '"') // Unescape quotes
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();

      // Truncate to roughly 150-200 characters (one solid sentence)
      if (summary.length > 200) {
        summary = summary.substring(0, 197) + "...";
      }

      return summary;
    }

    // If no snippet, try to extract from body
    if (email.body) {
      const lines = email.body
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .filter((line) => !line.startsWith(">")) // Skip quoted text
        .slice(0, 2);

      if (lines.length > 0) {
        summary = lines
          .join(" ")
          .substring(0, 200)
          .replace(/\s+/g, " ")
          .trim();
        if (summary.length === 200) {
          summary += "...";
        }
        return summary;
      }
    }

    return "(No preview available)";
  }

  /**
   * Get recommended action for an email
   */
  private getRecommendedAction(
    email: GmailMessage,
    category: EmailCategory
  ): string | undefined {
    switch (category) {
      case EmailCategory.NEEDS_ACTION:
        return this.generateActionSuggestion(email);

      case EmailCategory.INVITE_OR_TIME_SENSITIVE:
        return this.generateInviteAction(email);

      case EmailCategory.IMPORTANT_FYI:
      case EmailCategory.LOW_PRIORITY:
      default:
        return undefined;
    }
  }

  private generateActionSuggestion(email: GmailMessage): string {
    const subject = email.subject.toLowerCase();
    const body = (email.body || "").toLowerCase();

    if (
      subject.includes("approval") ||
      subject.includes("approve") ||
      body.includes("please approve")
    ) {
      return "Review and approve";
    }

    if (subject.includes("reply") || body.includes("please reply")) {
      return "Reply with response";
    }

    if (
      subject.includes("feedback") ||
      body.includes("please provide feedback")
    ) {
      return "Provide feedback";
    }

    if (subject.includes("billing") || subject.includes("invoice")) {
      return "Process payment or review invoice";
    }

    if (subject.includes("update") || body.includes("update required")) {
      return "Update account or information";
    }

    return "Action required";
  }

  private generateInviteAction(email: GmailMessage): string {
    if (email.hasInvitation) {
      return "Review and respond to invitation";
    }

    const subject = email.subject.toLowerCase();
    if (
      subject.includes("webinar") ||
      subject.includes("workshop") ||
      subject.includes("conference")
    ) {
      return "Register if interested";
    }

    return "Check date/time and add to calendar";
  }

  /**
   * Format sender email for display
   */
  private formatSender(from: string): string {
    // Extract name and email
    const match = from.match(/^(.*?)\s*<(.*)>$/);
    if (match) {
      const name = match[1].trim();
      const email = match[2].trim();

      if (name && name !== email) {
        return `${name}`;
      }
      return email;
    }

    // If no name, just return email
    return from.trim();
  }

  /**
   * Generate HTML digest email
   */
  generateDigestHtml(
    needsActionItems: DigestItem[],
    inviteItems: DigestItem[],
    fyyItems: DigestItem[],
    lowPriorityCount: number,
    totalProcessed: number
  ): string {
    const today = new Date().toISOString().split("T")[0];

    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 3px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { margin: 0; font-size: 24px; color: #1f2937; }
    .header p { margin: 8px 0 0 0; color: #6b7280; font-size: 14px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
    .email-item { margin-bottom: 16px; padding: 12px; background: #f9fafb; border-left: 4px solid #d1d5db; }
    .email-item.action { border-left-color: #ff6b6b; }
    .email-item.invite { border-left-color: #4f46e5; }
    .email-item.fyi { border-left-color: #f59e0b; }
    .email-from { font-weight: 600; color: #374151; margin-bottom: 4px; font-size: 14px; }
    .email-subject { font-size: 14px; color: #1f2937; margin-bottom: 8px; }
    .email-snippet { color: #6b7280; font-size: 13px; margin-bottom: 8px; line-height: 1.5; }
    .email-action { color: #2563eb; font-size: 12px; font-weight: 500; }
    .summary-stats { background: #f3f4f6; padding: 12px; border-radius: 4px; font-size: 13px; color: #6b7280; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; margin-right: 4px; }
    .badge-action { background: #fee2e2; color: #991b1b; }
    .badge-invite { background: #eef2ff; color: #3730a3; }
    .badge-fyi { background: #fef3c7; color: #92400e; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📧 Daily Inbox Summary</h1>
      <p>${today} • ${totalProcessed} email${totalProcessed !== 1 ? "s" : ""} processed</p>
    </div>
`;

    // Needs Action section
    if (needsActionItems.length > 0) {
      html += this.formatSection(
        "🔴 Needs Action",
        needsActionItems,
        "action"
      );
    }

    // Invites and Time-sensitive section
    if (inviteItems.length > 0) {
      html += this.formatSection(
        "📅 Invitations & Time-Sensitive",
        inviteItems,
        "invite"
      );
    }

    // Important FYI section
    if (fyyItems.length > 0) {
      html += this.formatSection(
        "ℹ️ Important FYI",
        fyyItems,
        "fyi"
      );
    }

    // Summary section
    html += `
    <div class="section">
      <div class="summary-stats">
        <strong>${lowPriorityCount}</strong> low-priority email${lowPriorityCount !== 1 ? "s" : ""} automatically marked as read
      </div>
    </div>
`;

    // Footer
    html += `
    <div class="footer">
      <p>Generated by <strong>OpenClaw Gmail Agent</strong> • <a href="https://github.com/jennyren9/openclaw-gmail-agent">View on GitHub</a></p>
      <p style="margin: 8px 0 0 0;">This is an automated summary. Mark emails as unread in Gmail to keep them in your inbox.</p>
    </div>
  </div>
</body>
</html>
`;

    return html;
  }

  private formatSection(
    title: string,
    items: DigestItem[],
    type: string
  ): string {
    let html = `
    <div class="section">
      <div class="section-title">${title}</div>
`;

    for (const item of items) {
      html += `
      <div class="email-item ${type}">
        <div class="email-from">
          <span class="badge badge-${type}">${type.toUpperCase()}</span>
          ${this.escapeHtml(item.from)}
        </div>
        <div class="email-subject">${this.escapeHtml(item.subject)}</div>
        <div class="email-snippet">${this.escapeHtml(item.summary)}</div>
`;

      if (item.recommendedAction) {
        html += `        <div class="email-action">→ ${this.escapeHtml(item.recommendedAction)}</div>\n`;
      }

      html += `      </div>\n`;
    }

    html += `    </div>\n`;
    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
