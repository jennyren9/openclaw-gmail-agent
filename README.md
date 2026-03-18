# OpenClaw Gmail Agent

A secure, TypeScript-based personal email assistant that reads your Gmail inbox, generates daily summaries, manages labels, and adds important events to Google Calendar—all with idempotent processing to prevent duplicates.

## Features

- **Daily Email Summaries**: Automatically generates and sends a formatted digest every day at 8:00 AM (configurable)
- **Smart Classification**: Uses conservative heuristics to categorize emails:
  - 🔴 Needs Action (approval, requests, billing)
  - 📅 Invitations & Time-Sensitive (calendar invites, deadlines)
  - ℹ️ Important FYI (important updates)
  - 📋 Low Priority (newsletters, promotions, auto-marked as read)
- **Calendar Integration**: Automatically adds calendar invitations and time-sensitive events to Google Calendar
- **Gmail Labels**: Creates and applies custom labels for organization
- **Idempotent Processing**: Prevents duplicate digests and calendar events via SQLite-based state tracking
- **Dry-Run Mode**: Preview digests without sending emails or making changes
- **Privacy-First**: All secrets in environment variables, no API keys in code

## Architecture

```
src/
├── connectors/
│   ├── gmail.ts          # Gmail API integration
│   └── calendar.ts       # Google Calendar API integration
├── core/
│   ├── classifier.ts     # Email classification logic
│   ├── summarizer.ts     # Summary generation
│   ├── event_extractor.ts # Calendar event extraction
│   └── state_store.ts    # SQLite state persistence
├── jobs/
│   └── daily_digest.ts   # Main orchestration job
├── types/
│   └── index.ts          # TypeScript interfaces
├── config.ts             # Configuration management
└── index.ts              # CLI entry point
```

## Prerequisites

- Node.js 18+ and npm
- Google Cloud Project with Gmail and Calendar APIs enabled
- OAuth 2.0 credentials (Client ID and Client Secret)

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Google Cloud Setup

#### Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - **Gmail API**: Search for "Gmail API" and click Enable
   - **Google Calendar API**: Search for "Google Calendar API" and click Enable

#### Create OAuth 2.0 Credentials

1. In Google Cloud Console, go to **Credentials** (left navigation)
2. Click **Create Credentials** → **OAuth 2.0 Client IDs**
3. Choose **Desktop application** as the application type
4. Download the credentials as JSON
5. Extract these values:
   - `client_id`
   - `client_secret`

### 3. Environment Configuration

```bash
# Copy the example file
cp .env.example .env

# Edit .env with your values
nano .env
```

Fill in:
```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
PRIMARY_GMAIL_ACCOUNT=renjing99@gmail.com
DIGEST_RECIPIENT_EMAIL=renjing99@gmail.com
DIGEST_SCHEDULE=0 8 * * *
DIGEST_TIMEZONE=America/Los_Angeles
```

### 4. OAuth Token Authentication

Before running the digest, you need to authenticate with Google:

```bash
# Run authentication flow (coming in v1)
npm run auth:gmail
npm run auth:calendar
```

This will:
1. Open your browser to Google's OAuth consent screen
2. Ask you to authorize the application
3. Store the access tokens securely in the SQLite database

**For now, manually add tokens to the database or use the stored credentials from a successful OAuth flow.**

## Usage

### Preview Digest (Dry-Run Mode)

Generate a digest preview without sending emails or making changes:

```bash
npm run digest:dry-run
```

This will:
- Read recent emails
- Classify them
- Generate an HTML preview
- Save preview to `previews/digest_[timestamp].html`
- Show summary in console

**No labels applied. No emails marked read. No calendar events created. No digest sent.**

### Send Live Digest

Process emails and send the daily digest:

```bash
npm run digest:run
```

This will:
- Read recent emails
- Classify and summarize them
- Apply Gmail labels
- Mark low-priority emails as read (configurable)
- Create calendar events for invitations
- Send digest email to the configured recipient

### Run in Development Mode

```bash
npm run dev
```

Shows available commands and usage information.

## Configuration Options

### Environment Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | `xxx.apps.googleusercontent.com` | OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | `your_secret` | OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/oauth/callback` | OAuth 2.0 Redirect URI |
| `PRIMARY_GMAIL_ACCOUNT` | `renjing99@gmail.com` | Gmail account to read from |
| `DIGEST_RECIPIENT_EMAIL` | `renjing99@gmail.com` | Where to send the digest |
| `DIGEST_SCHEDULE` | `0 8 * * *` | Cron expression for daily run |
| `DIGEST_TIMEZONE` | `America/Los_Angeles` | Timezone for scheduling |
| `EMAIL_LOOKBACK_HOURS` | `24` | How many hours back to read emails |
| `DATABASE_PATH` | `./data/openclaw.db` | Path to SQLite database |
| `MARK_LOW_PRIORITY_AS_READ` | `true` | Auto-read newsletters/promos |
| `MARK_FYI_AS_READ_AFTER_DIGEST` | `false` | Auto-read FYI emails after digest |
| `MARK_ACTION_ITEMS_AS_READ` | `false` | Auto-read action items |
| `DRY_RUN` | `false` | Prevent any state changes |

### Gmail Labels Created

The agent creates these labels in your Gmail account:

- `OpenClaw/Needs Action` - Emails requiring response
- `OpenClaw/Important FYI` - Important but no action needed
- `OpenClaw/Invite` - Calendar invitations and time-sensitive
- `OpenClaw/Low Priority` - Newsletters, promotions, etc.
- `OpenClaw/Summarized` - Included in digest
- `OpenClaw/Calendared` - Calendar event created

## Scheduling (Production)

### Using Cron (Linux/Mac)

Edit your crontab:

```bash
crontab -e
```

Add:

```cron
# Run digest at 8 AM Pacific Time every day
0 8 * * * cd /path/to/openclaw-gmail-agent && npm run digest:run >> /var/log/openclaw-digest.log 2>&1
```

### Using GitHub Actions (Cloud)

Create `.github/workflows/daily-digest.yml`:

```yaml
name: Daily Digest
on:
  schedule:
    # 8 AM PT = 4 PM UTC
    - cron: '0 16 * * *'

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm install
      - run: npm run digest:run
        env:
          GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}
          GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
          # ... other secrets
```

### Using External Scheduler (e.g., EasyCron)

1. Deploy this app to a cloud server
2. Create an HTTP endpoint (extend `src/index.ts`)
3. Set up EasyCron or similar to POST to your endpoint daily

## Classification Logic

### Needs Action

Detected by:
- Direct asks: "please review", "approval needed", "request"
- Keywords: "action required", "follow up", "feedback"
- Service emails: billing, verification, confirmations
- Directed at user: starts with "you"

### Invitations & Time-Sensitive

Detected by:
- Calendar invitation metadata
- ICS attachments
- Keywords: "meeting", "webinar", "deadline", "expires"
- Urgent indicators: "today", "tomorrow", "urgent", "ASAP"

### Important FYI

Default category for important information that doesn't require action.

### Low Priority

Detected by:
- Newsletter indicators: "newsletter", "weekly digest", "unsubscribe"
- Promotional: "50% off", "limited time", "deal"
- Social/automated: notifications from social media, GitHub, etc.
- Bulk email indicators

## Testing

```bash
# Run test suite
npm run test

# Run with coverage
npm run test:coverage

# Type checking
npm run type-check

# Linting
npm run lint
```

## API Scopes

The application requests the following Google API scopes:

### Gmail API
- `https://www.googleapis.com/auth/gmail.readonly` - Read emails
- `https://www.googleapis.com/auth/gmail.modify` - Apply labels, mark read
- `https://www.googleapis.com/auth/gmail.send` - Send digest email

### Google Calendar API
- `https://www.googleapis.com/auth/calendar` - Create events

## Security Considerations

✅ **What This Agent Does Safely**

- Uses OAuth 2.0 with user consent
- Stores tokens securely in SQLite with proper isolation
- Never logs sensitive data
- Cleans up credentials on errors
- No email forwarding or auto-replies
- No auto-deletion
- Conservative classification to avoid false positives

⚠️ **What This Agent Does NOT Do**

- Never auto-deletes emails
- Never auto-repliesautomatically
- Never forwards without user setup
- Never logs email content in production
- Never stores credentials in environment variables (only uses them)
- Requires explicit OAuth consent from user

🔒 **Best Practices**

1. **Keep `.env` file secret**: Add to `.gitignore`
2. **Use service account for production**: Consider a Google Service Account instead of OAuth for production
3. **Rotate credentials periodically**: Regenerate OAuth tokens monthly
4. **Monitor access logs**: Check Gmail account for unusual access
5. **Test with dry-run first**: Always preview digests before sending
6. **Audit labels regularly**: Verify labels are being applied correctly

## Troubleshooting

### "Missing OAuth tokens" Error

You need to authenticate with Google first.

```bash
npm run auth:gmail
npm run auth:calendar
```

### Emails Not Being Classified

Check that email subjects and bodies contain clear keywords. Low-confidence classifications default to "Important FYI".

### Calendar Events Not Created

- Verify Google Calendar API is enabled
- Check OAuth scope includes calendar permissions
- Review event confidence threshold (must be > 0.75)

### Digest Not Sending

- Verify email account credentials are correct
- Check SMTP settings (using Gmail OAuth, not user password)
- Review email providers' filtering rules

## Future Enhancements

### Multi-Account Support (v2)

The architecture supports extending to multiple email accounts:

```typescript
// Future: MultiAccountDigest
const accounts = [
  'renjing99@gmail.com',
  'work@company.com',
  'project@domain.com'
];

for (const account of accounts) {
  const digest = await runDigestForAccount(account);
}
```

### AI Summarization (v2+)

Pluggable summarization models:

```typescript
type SummarizationModel = {
  summarizeEmail(email: GmailMessage): Promise<string>;
};

// Use OpenAI, Claude, or Llama for summaries
const summarizer = new CodexSummarizer(openaiKey);
```

### Smart Filters (v2+)

- Content-based filtering (sender allowlists)
- Regex/pattern-based rules
- Domain-based categorization
- Custom "Trusted Senders" for calendar confidence

## License

MIT

## Contributing

Contributions welcome! Please open issues and PRs for:
- Bug fixes
- New classification rules
- Better event extraction
- Performance improvements
- Documentation

## Support

For issues or feature requests, open an issue on GitHub:
[openclaw-gmail-agent Issues](https://github.com/jennyren9/openclaw-gmail-agent/issues)
