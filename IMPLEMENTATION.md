# OpenClaw Gmail Agent - Quick Start Guide

## Project Successfully Created! ✓

Your complete OpenClaw Gmail Agent has been built with all required components:

### Project Structure

```
openclaw-gmail-agent/
├── src/
│   ├── connectors/
│   │   ├── gmail.ts              # Gmail API integration (read, label, send)
│   │   └── calendar.ts           # Google Calendar API integration
│   ├── core/
│   │   ├── classifier.ts         # Email classification (4 categories)
│   │   ├── summarizer.ts         # HTML digest generation
│   │   ├── event_extractor.ts    # ICS/text-based event parsing
│   │   └── state_store.ts        # SQLite persistence layer
│   ├── jobs/
│   │   └── daily_digest.ts       # Main orchestration logic
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces
│   ├── config.ts                 # Configuration management
│   └── index.ts                  # CLI entry point
├── tests/
│   └── core.test.ts              # Classifier, extractor, dedup tests
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript configuration
├── vitest.config.ts              # Test configuration
├── .env.example                  # Environment template
├── README.md                      # Comprehensive documentation
└── .gitignore                    # Git ignore rules
```

## Key Features Implemented

### 1. **Email Classification** ✓
- Conservative heuristics for 4 categories
- Action items, invites/time-sensitive, FYI, low-priority
- Confidence scores and reasoning strings
- No over-fitted AI - uses keyword patterns

### 2. **Daily Digest Generation** ✓
- Beautiful HTML email format
- Categorized sections (action, invites, FYI)
- One-liner summaries per email
- Recommended actions for each item
- Generated daily at 8 AM PT

### 3. **Gmail Integration** ✓
- Read inbox emails from last 24 hours
- Create and apply custom labels
- Mark emails as read/unread
- Send digest emails
- Full OAuth 2.0 support

### 4. **Google Calendar Integration** ✓
- Extract events from email text and ICS attachments
- Create calendar events with confidence thresholds
- Track created events to prevent duplicates
- Support for timezones and all-day events

### 5. **State Persistence** ✓
- SQLite database for message tracking
- Tracks processed emails, digests, and calendar events
- Prevents duplicate summaries even on multiple runs
- OAuth token storage

### 6. **CLI Commands** ✓
- `npm run digest:dry-run` - Preview digest, no changes
- `npm run digest:run` - Send digest, apply labels, create events
- `npm run test` - Run test suite
- `npm run build` - Compile TypeScript
- `npm run type-check` - Static type checking

### 7. **Gmail Labels** ✓
Auto-created labels:
- `OpenClaw/Needs Action`
- `OpenClaw/Important FYI`
- `OpenClaw/Invite`
- `OpenClaw/Low Priority`
- `OpenClaw/Summarized`
- `OpenClaw/Calendared`

### 8. **Comprehensive Testing** ✓
- Classifier tests for all categories
- Event extraction tests (ICS and text)
- Deduplication logic verification
- Vitest + coverage support

## Next Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Google Cloud

Follow the detailed instructions in `README.md`:
- Create Google Cloud Project
- Enable Gmail API and Google Calendar API
- Create OAuth 2.0 credentials
- Note your Client ID and Client Secret

### 3. Setup Environment
```bash
cp .env.example .env

# Edit .env and fill in:
# - GOOGLE_CLIENT_ID
# - GOOGLE_CLIENT_SECRET
# - GOOGLE_REDIRECT_URI
# - PRIMARY_GMAIL_ACCOUNT
# - DIGEST_RECIPIENT_EMAIL
```

### 4. Authenticate

Before running the digest, authenticate with Google:
- The application will use OAuth 2.0 to request permissions
- Tokens are stored securely in SQLite
- User sees standard Google consent screen

### 5. Test with Dry-Run

```bash
npm run digest:dry-run
```

This will:
- Read recent emails (no changes)
- Classify them
- Generate HTML preview
- Save to `previews/digest_[timestamp].html`

### 6. Send Live Digest

```bash
npm run digest:run
```

This will:
- Process emails properly
- Apply labels
- Create calendar events
- Send digest email

## Architecture Highlights

### Modular Design
Each component is independently testable:
- **Classifier**: Pure heuristics, easy to replace with AI
- **Summarizer**: Can swap for AI models (OpenAI, Claude)
- **EventExtractor**: Handles both ICS and text parsing
- **Connectors**: Abstracted APIs, easy to swap implementations

### Idempotency
- Tracks processed message IDs in database
- Digest only sent once per day
- Calendar events never duplicated
- Safe to run multiple times per day

### Privacy & Security
- OAuth 2.0 with user consent
- No email content logged
- No auto-delete or auto-reply
- Configurable read-marking behavior
- Tokens stored in local SQLite only

### Extensibility
- Built for multi-account support (v2)
- Plugin architecture for summarization/classification
- Domain-based sender trust system
- Custom filter support planned

## Configuration Options

Key environment variables:

| Variable | Purpose | Example |
|----------|---------|---------|
| `PRIMARY_GMAIL_ACCOUNT` | Email to read from | `renjing99@gmail.com` |
| `DIGEST_RECIPIENT_EMAIL` | Where to send digest | `renjing99@gmail.com` |
| `DIGEST_SCHEDULE` | Cron timing | `0 8 * * *` (8 AM daily) |
| `DIGEST_TIMEZONE` | Digest timezone | `America/Los_Angeles` |
| `EMAIL_LOOKBACK_HOURS` | Hours back to read | `24` |
| `MARK_LOW_PRIORITY_AS_READ` | Auto-mark as read | `true` |

See `.env.example` for all options.

## Testing

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

Tests cover:
- Email classification for all 4 categories
- Event extraction (ICS + text patterns)
- Deduplication logic
- Confidence scoring

## Production Deployment

### Option 1: Cron Job (Linux/Mac)
```bash
crontab -e
# Add: 0 8 * * * cd /path/to/app && npm run digest:run
```

### Option 2: GitHub Actions
See `README.md` for workflow example - runs digest daily via GitHub Actions.

### Option 3: Cloud Scheduler
Deploy to Vercel/AWS Lambda with HTTP endpoint, trigger from cloud scheduler.

## Troubleshooting

### "Missing OAuth tokens" on first run
This is expected. You need to authenticate:
1. Follow the OAuth setup in README
2. User browses to Google consent screen
3. Tokens automatically saved

### Emails not being classified as expected
- Check email subjects/bodies for keyword patterns
- Run `npm run digest:dry-run` to see classifications
- Adjust classifier thresholds in `src/core/classifier.ts`

### Calendar events not created
- Verify Google Calendar API is enabled
- Check OAuth scope includes calendar permissions
- Event confidence must be > 0.75

### Digest not sending
- Verify email configuration in `.env`
- Check Gmail OAuth has send permission
- Review email content for spam filters

## Support & Contributing

- **Documentation**: See comprehensive `README.md`
- **Issues**: Add tests to verify bugs, PR with fixes
- **Features**: Submit PR with tests for new classification rules

## What's NOT Included (By Design)

✗ Auto-delete emails  
✗ Auto-reply to emails  
✗ Auto-forward emails  
✗ AI summarization (v1 - can be added)  
✗ Multi-account support (v1 - ready for v2)  
✗ OAuth setup wizard (manual, documented)  
✗ Web UI (CLI-based)  

## Health Check

All components created:
- ✓ 10 TypeScript source files
- ✓ 1 test file with classifier, extractor, dedup tests
- ✓ Complete `README.md` with setup instructions
- ✓ `.env.example` template
- ✓ SQLite persistence layer
- ✓ Gmail + Calendar connectors
- ✓ CLI with dry-run and live modes
- ✓ Package.json with all dependencies

## Next: Run the App!

```bash
# First time setup
npm install

# Copy and edit configuration
cp .env.example .env
# (Fill in your Google Cloud credentials)

# Test with dry-run
npm run digest:dry-run

# Or run tests
npm run test
```

Happy emailing! 📧
