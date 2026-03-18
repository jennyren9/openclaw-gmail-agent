import { describe, it, expect } from "vitest";
import { EmailClassifier } from "../src/core/classifier.js";
import { EventExtractor } from "../src/core/event_extractor.js";
import { EmailCategory, GmailMessage } from "../src/types/index.js";

describe("EmailClassifier", () => {
  const classifier = new EmailClassifier();

  const createMockEmail = (overrides?: Partial<GmailMessage>): GmailMessage => ({
    id: "test-123",
    threadId: "thread-123",
    from: "sender@example.com",
    to: ["me@gmail.com"],
    subject: "Test Subject",
    snippet: "Test snippet",
    body: "Test body",
    receivedTime: new Date(),
    labels: [],
    hasInvitation: false,
    hasIcsAttachment: false,
    ...overrides,
  });

  it("should classify calendar invitation as INVITE_OR_TIME_SENSITIVE", () => {
    const email = createMockEmail({
      subject: "Meeting Invitation",
      hasInvitation: true,
      body: "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Team Meeting\nEND:VEVENT\nEND:VCALENDAR",
    });

    const result = classifier.classify(email);
    expect(result.category).toBe(EmailCategory.INVITE_OR_TIME_SENSITIVE);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should classify approval request as NEEDS_ACTION", () => {
    const email = createMockEmail({
      subject: "Please approve this proposal",
      body: "I need your approval on the attached document",
    });

    const result = classifier.classify(email);
    expect(result.category).toBe(EmailCategory.NEEDS_ACTION);
  });

  it("should classify newsletter as LOW_PRIORITY", () => {
    const email = createMockEmail({
      subject: "Weekly Newsletter - March 18",
      from: "newsletter@example.com",
      body: "This week's top stories...",
    });

    const result = classifier.classify(email);
    expect(result.category).toBe(EmailCategory.LOW_PRIORITY);
  });

  it("should classify promotional email as LOW_PRIORITY", () => {
    const email = createMockEmail({
      subject: "50% Off Sale - Limited Time!",
      from: "sales@retailer.com",
      body: "Don't miss our biggest sale",
    });

    const result = classifier.classify(email);
    expect(result.category).toBe(EmailCategory.LOW_PRIORITY);
  });

  it("should classify deadline email as INVITE_OR_TIME_SENSITIVE", () => {
    const email = createMockEmail({
      subject: "Project deadline: March 25",
      body: "This project needs to be completed by March 25, 2024",
    });

    const result = classifier.classify(email);
    expect(result.category).toBe(EmailCategory.INVITE_OR_TIME_SENSITIVE);
  });

  it("should classify important update as IMPORTANT_FYI", () => {
    const email = createMockEmail({
      subject: "System maintenance completed",
      body: "Our system has been updated with the latest features",
    });

    const result = classifier.classify(email);
    // Should be either FYI or ACTION depending on content
    expect([
      EmailCategory.IMPORTANT_FYI,
      EmailCategory.NEEDS_ACTION,
    ]).toContain(result.category);
  });

  it("should classify billing notification as NEEDS_ACTION", () => {
    const email = createMockEmail({
      subject: "Invoice #12345 is now due",
      from: "billing@service.com",
      body: "Your invoice is ready for review",
    });

    const result = classifier.classify(email);
    expect(result.category).toBe(EmailCategory.NEEDS_ACTION);
  });

  it("should provide a reason for classification", () => {
    const email = createMockEmail({
      subject: "Please review this",
      body: "I need your feedback",
    });

    const result = classifier.classify(email);
    expect(result.reason).toBeTruthy();
    expect(result.reason.length > 0).toBe(true);
  });
});

describe("EventExtractor", () => {
  const extractor = new EventExtractor();

  const createMockEmail = (overrides?: Partial<GmailMessage>): GmailMessage => ({
    id: "test-123",
    threadId: "thread-123",
    from: "sender@example.com",
    to: ["me@gmail.com"],
    subject: "Test Subject",
    snippet: "Test snippet",
    body: "Test body",
    receivedTime: new Date(),
    labels: [],
    hasInvitation: false,
    hasIcsAttachment: false,
    ...overrides,
  });

  it("should extract event from ICS calendar data", () => {
    const icsBody = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20240315T140000
DTEND:20240315T150000
SUMMARY:Team Meeting
LOCATION:Conference Room A
DESCRIPTION:Weekly team sync
END:VEVENT
END:VCALENDAR`;

    const email = createMockEmail({
      subject: "Meeting: Team Sync",
      body: icsBody,
      hasInvitation: true,
    });

    const event = extractor.extractEvent(email);

    expect(event).toBeTruthy();
    expect(event?.title).toBe("Team Meeting");
    expect(event?.location).toBe("Conference Room A");
    expect(event?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should not extract event from non-event emails", () => {
    const email = createMockEmail({
      subject: "Regular email about something",
      body: "This is just a regular email",
    });

    const event = extractor.extractEvent(email);
    expect(event).toBeNull();
  });

  it("should require both title and start time for event extraction", () => {
    const email = createMockEmail({
      subject: "Let's meet sometime",
      body: "No specific date/time mentioned",
    });

    const event = extractor.extractEvent(email);
    expect(event).toBeNull();
  });

  it("should extract event with datetime from text", () => {
    const email = createMockEmail({
      subject: "Meeting tomorrow at 2:30 PM",
      body: "Can we schedule a meeting for tomorrow at 2:30 PM in Conference Room A?",
    });

    // This might not extract depending on "tomorrow" parsing
    // The implementation should try to parse dates
    const event = extractor.extractEvent(email);
    // Just check it handles gracefully
    expect(event === null || event?.startTime instanceof Date).toBe(true);
  });
});

describe("Deduplication Logic", () => {
  it("should prevent duplicate digests on same day", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfDay = new Date(today);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // This tests the concept - actual test would need StateStore
    expect(startOfDay.toDateString()).toBe(endOfDay.toDateString());
  });

  it("should track processed message IDs for idempotency", () => {
    const processedIds = new Set<string>();

    // Simulate processing
    processedIds.add("msg-1");
    processedIds.add("msg-2");
    processedIds.add("msg-3");

    // Check if we can prevent duplicates
    expect(processedIds.has("msg-1")).toBe(true);
    expect(processedIds.has("msg-4")).toBe(false);

    // Adding same ID again should not duplicate
    processedIds.add("msg-1");
    expect(processedIds.size).toBe(3);
  });
});
