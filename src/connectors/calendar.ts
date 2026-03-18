import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { ExtractedEvent } from "../types/index.js";
import { StateStore } from "../core/state_store.js";

/**
 * Google Calendar connector for creating and managing calendar events
 */
export class CalendarConnector {
  private oauth2Client: OAuth2Client;
  private calendar = google.calendar("v3");
  private stateStore: StateStore;
  private calendarId: string = "primary";

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
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/calendar"],
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
    this.stateStore.storeOAuthToken(
      "calendar",
      tokens.access_token!,
      tokens.refresh_token,
      tokens.expiry_date,
      ["https://www.googleapis.com/auth/calendar"]
    );
  }

  /**
   * Refresh access token if needed
   */
  async ensureValidToken(): Promise<void> {
    const credentials = this.oauth2Client.credentials;
    if (!credentials.expiry_date || credentials.expiry_date > Date.now()) {
      return;
    }

    const { credentials: newCredentials } =
      await this.oauth2Client.refreshAccessToken();
    this.oauth2Client.setCredentials(newCredentials);

    this.stateStore.storeOAuthToken(
      "calendar",
      newCredentials.access_token!,
      newCredentials.refresh_token,
      newCredentials.expiry_date,
      ["https://www.googleapis.com/auth/calendar"]
    );
  }

  /**
   * Create a calendar event from extracted data
   */
  async createEvent(event: ExtractedEvent): Promise<string> {
    await this.ensureValidToken();

    const eventBody: any = {
      summary: event.title,
      description: event.description,
      start: {
        dateTime: event.startTime.toISOString(),
        timeZone: event.timezone,
      },
      end: event.endTime
        ? {
            dateTime: event.endTime.toISOString(),
            timeZone: event.timezone,
          }
        : undefined,
      location: event.location,
      source: {
        title: "OpenClaw Gmail Agent",
        url: "https://github.com/jennyren9/openclaw-gmail-agent",
      },
    };

    // Add a note linking back to the source email
    if (event.messageId) {
      eventBody.description =
        (eventBody.description ? eventBody.description + "\n\n" : "") +
        `Source: Gmail message ${event.messageId}`;
    }

    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: eventBody,
    });

    return res.data.id!;
  }

  /**
   * Check if an event already exists for a message
   */
  async eventExistsForMessage(messageId: string): Promise<boolean> {
    // This checks the state store - calendar API doesn't have good way to query by source
    return this.stateStore.hasCalendarEvent(messageId);
  }

  /**
   * Get an event by ID
   */
  async getEvent(eventId: string): Promise<any> {
    await this.ensureValidToken();

    const res = await this.calendar.events.get({
      calendarId: this.calendarId,
      eventId,
    });

    return res.data;
  }

  /**
   * Update an event
   */
  async updateEvent(eventId: string, eventData: any): Promise<void> {
    await this.ensureValidToken();

    await this.calendar.events.update({
      calendarId: this.calendarId,
      eventId,
      requestBody: eventData,
    });
  }

  /**
   * Delete an event
   */
  async deleteEvent(eventId: string): Promise<void> {
    await this.ensureValidToken();

    await this.calendar.events.delete({
      calendarId: this.calendarId,
      eventId,
    });
  }

  /**
   * List events for a date range
   */
  async listEvents(startDate: Date, endDate: Date): Promise<any[]> {
    await this.ensureValidToken();

    const res = await this.calendar.events.list({
      calendarId: this.calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    return res.data.items || [];
  }
}
