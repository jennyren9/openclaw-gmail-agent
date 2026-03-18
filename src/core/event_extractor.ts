import { GmailMessage, ExtractedEvent } from "../types/index.js";

/**
 * Extracts calendar events from emails
 */
export class EventExtractor {
  /**
   * Try to extract event details from an email
   */
  extractEvent(email: GmailMessage): ExtractedEvent | null {
    // Try ICS parsing first if available
    if (email.hasIcsAttachment || email.body?.includes("BEGIN:VCALENDAR")) {
      const event = this.parseIcsEvent(email);
      if (event) {
        return event;
      }
    }

    // Fall back to text parsing
    return this.extractEventFromText(email);
  }

  /**
   * Parse ICS/iCal format
   */
  private parseIcsEvent(email: GmailMessage): ExtractedEvent | null {
    const content = email.body || "";

    // Simple ICS parser for calendar invitations
    if (!content.includes("BEGIN:VCALENDAR")) {
      return null;
    }

    try {
      const event: ExtractedEvent = {
        messageId: email.id,
        title: email.subject,
        timezone: "America/Los_Angeles",
        confidence: 0.95,
      };

      // Parse SUMMARY
      const summaryMatch = content.match(/SUMMARY:([^\r\n]+)/);
      if (summaryMatch) {
        event.title = this.unescapeIcsText(summaryMatch[1]);
      }

      // Parse DTSTART
      const dtStartMatch = content.match(/DTSTART(?::TZID=([^:]*?))?:([^\r\n]+)/);
      if (dtStartMatch) {
        const tzid = dtStartMatch[1];
        const dtStart = dtStartMatch[2];

        if (tzid) {
          event.timezone = tzid;
        }

        const startTime = this.parseIcsDateTime(dtStart);
        if (startTime) {
          event.startTime = startTime;
        }
      }

      // Parse DTEND
      const dtEndMatch = content.match(/DTEND(?::TZID=([^:]*?))?:([^\r\n]+)/);
      if (dtEndMatch) {
        const dtEnd = dtEndMatch[2];
        const endTime = this.parseIcsDateTime(dtEnd);
        if (endTime) {
          event.endTime = endTime;
        }
      }

      // Parse LOCATION
      const locationMatch = content.match(/LOCATION:([^\r\n]+)/);
      if (locationMatch) {
        event.location = this.unescapeIcsText(locationMatch[1]);
      }

      // Parse DESCRIPTION
      const descriptionMatch = content.match(/DESCRIPTION:([^\r\n]+)/);
      if (descriptionMatch) {
        event.description = this.unescapeIcsText(descriptionMatch[1]);
      }

      // Must have start time to be valid
      if (event.startTime) {
        return event;
      }
    } catch (err) {
      console.error("Error parsing ICS event:", err);
    }

    return null;
  }

  /**
   * Extract event from email text using heuristics
   */
  private extractEventFromText(email: GmailMessage): ExtractedEvent | null {
    const subject = email.subject;
    const body = email.body || "";
    const combined = `${subject} ${body}`.toLowerCase();

    // Must match common event patterns
    const eventKeywords = [
      "meeting",
      "call",
      "conference",
      "webinar",
      "class",
      "appointment",
      "lunch",
      "dinner",
      "event",
      "workshop",
    ];

    if (
      !eventKeywords.some((kw) =>
        combined.includes(kw)
      )
    ) {
      return null;
    }

    const event: ExtractedEvent = {
      messageId: email.id,
      title: subject,
      timezone: "America/Los_Angeles",
      confidence: 0.6,
    };

    // Try to extract start time
    const startTime = this.extractDateTime(body || subject);
    if (!startTime) {
      return null; // Can't extract time, not a valid event for calendar
    }

    event.startTime = startTime;

    // Try to extract end time
    const endTime = this.extractEndDateTime(body || subject, startTime);
    if (endTime && endTime > startTime) {
      event.endTime = endTime;
    } else {
      // Default to 1 hour after start
      const defaultEnd = new Date(startTime);
      defaultEnd.setHours(defaultEnd.getHours() + 1);
      event.endTime = defaultEnd;
    }

    // Extract location if available
    const locationPatterns = [
      /(?:at|location|venue|address|room)[\s:]+([^,\n]+)/i,
      /(?:zoom|video call|google meet|conference room)[\s:]+([^\n]+)/i,
    ];

    for (const pattern of locationPatterns) {
      const match = body.match(pattern) || subject.match(pattern);
      if (match) {
        event.location = match[1].trim();
        break;
      }
    }

    // Lower confidence for text-extracted events
    event.confidence = 0.65;

    return event;
  }

  /**
   * Extract date/time from text
   */
  private extractDateTime(text: string): Date | null {
    // Common patterns for dates/times
    const patterns = [
      // ISO format: 2024-03-15T14:30:00
      {
        regex: /(\d{4})-(\d{2})-(\d{2})[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?/,
        toDate: (m: RegExpMatchArray) =>
          new Date(
            parseInt(m[1]),
            parseInt(m[2]) - 1,
            parseInt(m[3]),
            parseInt(m[4]),
            parseInt(m[5]),
            parseInt(m[6] || "0")
          ),
      },
      // US format: 03/15/2024 2:30 PM
      {
        regex: /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
        toDate: (m: RegExpMatchArray) => {
          let hour = parseInt(m[4]);
          if (m[6].toUpperCase() === "PM" && hour !== 12) hour += 12;
          if (m[6].toUpperCase() === "AM" && hour === 12) hour = 0;
          return new Date(
            parseInt(m[3]),
            parseInt(m[1]) - 1,
            parseInt(m[2]),
            hour,
            parseInt(m[5])
          );
        },
      },
      // Mon, Mar 15, 2024 at 2:30 PM
      {
        regex: /(\w+),?\s+(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+(?:at|at)?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
        toDate: (m: RegExpMatchArray) => {
          const monthMap: Record<string, number> = {
            january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
            july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
          };
          const month = monthMap[m[2].toLowerCase().substring(0, 3)];
          let hour = parseInt(m[5]);
          if (m[7]) {
            if (m[7].toUpperCase() === "PM" && hour !== 12) hour += 12;
            if (m[7].toUpperCase() === "AM" && hour === 12) hour = 0;
          }
          return new Date(parseInt(m[4]), month, parseInt(m[3]), hour, parseInt(m[6]));
        },
      },
    ];

    for (const { regex, toDate } of patterns) {
      const match = text.match(regex);
      if (match) {
        try {
          const date = toDate(match);
          if (!isNaN(date.getTime())) {
            return date;
          }
        } catch {
          // Continue to next pattern
        }
      }
    }

    return null;
  }

  /**
   * Extract end date/time from text (usually a duration or second time)
   */
  private extractEndDateTime(text: string, startTime: Date): Date | null {
    // Look for "duration" pattern
    const durationMatch = text.match(/(\d+)\s*(?:hour|hr|minute|min)s?/i);
    if (durationMatch) {
      const duration = parseInt(durationMatch[1]);
      const unit = durationMatch[0].toLowerCase();
      const endTime = new Date(startTime);

      if (unit.includes("hour") || unit.includes("hr")) {
        endTime.setHours(endTime.getHours() + duration);
      } else if (unit.includes("minute") || unit.includes("min")) {
        endTime.setMinutes(endTime.getMinutes() + duration);
      }

      return endTime;
    }

    // Look for end time after "to" or "-"
    const endTimePatterns = [
      /(?:to|until|-)\s+(\d{1,2}):(\d{2})\s*(?:AM|PM)?/i,
      /(?:to|until|-)\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
    ];

    for (const pattern of endTimePatterns) {
      const match = text.match(pattern);
      if (match) {
        const endTime = new Date(startTime);
        let hour = parseInt(match[1]);

        if (match[3]) {
          if (match[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
          if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
        }

        endTime.setHours(hour, parseInt(match[2]));
        if (endTime > startTime) {
          return endTime;
        }
      }
    }

    return null;
  }

  /**
   * Parse ICS date/time format
   */
  private parseIcsDateTime(dtStr: string): Date | null {
    // Format: 20240315T143000 or 20240315
    if (dtStr.includes("T")) {
      const match = dtStr.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
      if (match) {
        return new Date(
          parseInt(match[1]),
          parseInt(match[2]) - 1,
          parseInt(match[3]),
          parseInt(match[4]),
          parseInt(match[5]),
          parseInt(match[6])
        );
      }
    } else {
      const match = dtStr.match(/(\d{4})(\d{2})(\d{2})/);
      if (match) {
        return new Date(
          parseInt(match[1]),
          parseInt(match[2]) - 1,
          parseInt(match[3])
        );
      }
    }
    return null;
  }

  /**
   * Unescape ICS text (handles escaped characters)
   */
  private unescapeIcsText(text: string): string {
    return text
      .replace(/\\n/g, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
  }
}
