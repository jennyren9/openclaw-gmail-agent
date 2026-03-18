# OpenClaw Gmail Agent - Architecture & Flow

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Google APIs (OAuth 2.0)                     │
│  ┌──────────────────┐         ┌──────────────────────┐  │
│  │   Gmail API      │         │Google Calendar API   │  │
│  │                  │         │                      │  │
│  │ • Read emails    │         │ • Create events      │  │
│  │ • Apply labels   │         │ • Update events      │  │
│  │ • Send email     │         │ • List events        │  │
│  │ • Mark as read   │         │                      │  │
│  └────────┬─────────┘         └──────────┬───────────┘  │
└───────────┼───────────────────────────────┼──────────────┘
            │                               │
            │      ┌──────────────────────┐ │
            │      │  Connectors Layer    │ │
            │      │ ┌────────────────┐   │ │
            └─────→│ │ GmailConnector │   │ │
                   │ └────────────────┘   │ │
                   │ ┌──────────────────┐ │ │
                   └→│CalendarConnector │ │ │
                     └──────────────────┘│ │
                     └─────────┬──────────┘ │
                              │            │
┌─────────────────────────────┼────────────┼──────────────┐
│         Core Processing Layer            │              │
│  ┌──────────────────────────────────────┘              │
│  │                                                      │
│  │  EmailClassifier                                    │
│  │  ├─ NEEDS_ACTION                                    │
│  │  ├─ IMPORTANT_FYI                                   │
│  │  ├─ INVITE_OR_TIME_SENSITIVE                        │
│  │  └─ LOW_PRIORITY                                    │
│  │     (with confidence scores)                        │
│  │                                                      │
│  └──→ ┌─────────────────────┐                          │
│        │EmailSummarizer      │                          │
│        │ • Generate summaries │                          │
│        │ • Create HTML digest │                          │
│        │ • Format email      │                          │
│        └─────────┬───────────┘                          │
│                  │                                      │
│  ┌───────────────┴──────────────┐                       │
│  │                              │                       │
│  │  EventExtractor              │                       │
│  │  ├─ Parse ICS events         │                       │
│  │  ├─ Extract from text        │                       │
│  │  └─ Set confidence scores    │                       │
│  │                              │                       │
└──┼──────────────────────────────┼───────────────────────┘
   │                              │
   │  ┌────────────────────────────────────────┐
   │  │   DailyDigestJob (Orchestrator)        │
   │  │  • Fetch emails                        │
   │  │  • Classify all                        │
   │  │  • Summarize categorized items         │
   │  │  • Extract calendar events             │
   │  │  • Apply Gmail labels                  │
   │  │  • Mark as read (if configured)        │
   │  │  • Create calendar events              │
   │  │  • Update state store                  │
   │  │  • Send digest email                   │
   │  └───────────────┬────────────────────────┘
   │                  │
   └──────────────────┼──────────────────────────┐
                      │                          │
        ┌─────────────┴──────────┐              │
        │                        │              │
    ┌───▼──────┐        ┌───────▼──────┐      │
    │  StateStore    │  │  Environment │      │
    │  (SQLite)      │  │  Config      │      │
    │                │  │              │      │
    │ • Messages     │  │ • API keys   │      │
    │ • Digests      │  │ • Accounts   │      │
    │ • Events       │  │ • Schedules  │      │
    │ • Tokens       │  │ • Flags      │      │
    └────────────────┘  └──────────────┘      │
                                               │
                              ┌─────────────────┘
                              │
                        ┌─────▼──────┐
                        │    CLI      │
                        │             │
                        │ commands:   │
                        │ • dry-run   │
                        │ • run       │
                        │ • test      │
                        │ • build     │
                        └─────────────┘
```

## Daily Digest Flow

```
 START (8 AM Pacific)
   │
   ├─→ Load config from .env
   │
   ├─→ Connect to Gmail via OAuth
   │
   ├─→ Fetch emails from last 24 hours
   │   └─ Query: "in:inbox after:{24h ago}"
   │
   ├─→ For each email:
   │   │
   │   ├─→ Check if already processed (StateStore)
   │   │
   │   ├─→ Classify email → 4 categories
   │   │   └─ Use heuristic rules
   │   │
   │   ├─→ Group by category:
   │   │   ├─ NEEDS_ACTION
   │   │   ├─ INVITE_OR_TIME_SENSITIVE
   │   │   ├─ IMPORTANT_FYI
   │   │   └─ LOW_PRIORITY
   │   │
   │   ├─→ For INVITE category:
   │   │   ├─→ Try to extract event
   │   │   │   ├─ Parse ICS if available
   │   │   │   └─ Extract from text
   │   │   ├─→ Check confidence > 0.75
   │   │   └─→ Create calendar event
   │   │
   │   ├─→ Apply Gmail label
   │   │   └─ OpenClaw/{Category}
   │   │
   │   ├─→ Mark as read (if LOW_PRIORITY)
   │   │
   │   └─→ Record in StateStore
   │
   ├─→ Generate digest sections:
   │   ├─ Needs Action (with recommended actions)
   │   ├─ Invitations & Time-Sensitive
   │   ├─ Important FYI
   │   └─ Low Priority summary
   │
   ├─→ Create HTML email
   │
   ├─→ Send to digest recipient
   │
   ├─→ Record digest in StateStore
   │   └─ Prevents re-sending same day
   │
   └─→ END ✓
```

## Classification Decision Tree

```
Email received
   │
   ├─ Has calendar invite metadata?
   ├─ Has ICS attachment?
   ├─ Contains VCALENDAR?
   └─ Contains deadline/meeting keywords?
   └─→ INVITE_OR_TIME_SENSITIVE (confidence: 0.9+)
      └─ Extract deadlines, dates
   
   Otherwise:
   ├─ Contains action keywords?
   │  (please, approve, request, etc.)
   ├─ Is direct request?
   └─ Is from service account?
   └─→ NEEDS_ACTION (confidence: 0.7-0.95)
   
   Otherwise:
   ├─ Is newsletter/digest?
   ├─ Is promotional?
   ├─ Is social notification?
   ├─ Is bulk email?
   └─→ LOW_PRIORITY (confidence: 0.85-0.95)
   
   Otherwise:
   └─→ IMPORTANT_FYI (confidence: 0.6)
```

## State Persistence (SQLite)

```
Database: openclaw.db

Table: processed_messages
│ messageId (PK)
│ threadId
│ processedAt (DATE)
│ category (ENUM)
│ categoryClusters (JSON)
│ summarized (BOOL)
│ calendarEventId (FK)
└ labelsApplied (JSON)

Table: digests
│ digestId (PK)
│ date (DATETIME)
│ recipient (EMAIL)
│ emailMessageId (GMAIL_ID)
│ messageIds (JSON array)
│ createdEventIds (JSON array)
└ sentAt (DATETIME)

Table: oauth_tokens
│ account (PK)
│ accessToken
│ refreshToken
│ expireTime
│ scope (JSON)
└ updatedAt (DATETIME)

Indices:
│ processed_messages(messageId)
│ processed_messages(threadId)
│ digests(date)
└ oauth_tokens(account)
```

## Configuration Hierarchy

```
1. Environment Variables (.env)
   │
   ├─ GOOGLE_CLIENT_ID
   ├─ GOOGLE_CLIENT_SECRET
   ├─ GOOGLE_REDIRECT_URI
   │
   ├─ PRIMARY_GMAIL_ACCOUNT
   ├─ DIGEST_RECIPIENT_EMAIL
   │
   ├─ DIGEST_SCHEDULE (cron)
   ├─ DIGEST_TIMEZONE
   ├─ EMAIL_LOOKBACK_HOURS
   │
   ├─ DATABASE_PATH
   │
   ├─ MARK_LOW_PRIORITY_AS_READ
   ├─ MARK_FYI_AS_READ_AFTER_DIGEST
   ├─ MARK_ACTION_ITEMS_AS_READ
   │
   └─ DRY_RUN
      │
      └─→ AgentConfig object
         │
         └─→ Used by all modules
            ├─ Connectors
            ├─ Classifiers
            ├─ Jobs
            └─ Digest scheduler
```

## Idempotency Pattern

```
Digest for 2024-03-18:

Run 1 @ 8:00 AM:
├─ Check StateStore for digest with date = 2024-03-18
├─ Not found → PROCEED
├─ Process 48 emails
├─ Create digest with ID: digest_2024-03-18
├─ Record 48 message IDs in digest
├─ Send email
└─ Save DigestRecord to StateStore

Run 2 @ 8:05 AM (accidental/test):
├─ Check StateStore for digest with date = 2024-03-18
├─ Found digest_2024-03-18 → SKIP
└─ Return early, no duplicate sent ✓

Run 3 @ 8:10 AM (with same emails):
├─ Try to process same 48 emails
├─ Check StateStore.isMessageProcessed()
├─ Already processed → SKIP EACH
├─ No new items added
└─ No duplicate labels or calendar events ✓
```

## OAuth Token Lifecycle

```
1. Initial Authentication
   ├─ User runs: npx tsx src/utils/authenticate.ts
   ├─ App opens: https://accounts.google.com/o/oauth2/auth?...
   ├─ User authorizes app
   ├─ Browser redirects to: http://localhost:3000?code=AUTH_CODE
   ├─ App exchanges code for tokens
   ├─ Tokens stored in SQLite
   └─ User can now run digest

2. Token Refresh
   ├─ Before API call, check expiry
   ├─ If expired, use refresh_token to get new access_token
   ├─ Update StoredOAuthToken
   └─ Continue with request

3. Token Storage (Secure)
   └─ Only in local SQLite
   └─ Never logged
   └─ Never sent over network (except to Google)
   └─ Can be rotated by re-authenticating
```

## Error Handling Flow

```
Digest Run Error Scenarios:

Missing Config:
├─ Throw: "Missing required environment variables"
└─ User runs: cp .env.example .env && fill in values

Missing OAuth Tokens:
├─ Throw: "Missing OAuth tokens"
└─ User runs: npx tsx src/utils/authenticate.ts

Gmail API Error:
├─ Log error and continue with next email
├─ Partial digest with available emails
└─ User can retry

Classification Error:
├─ Default to IMPORTANT_FYI
├─ Log warning with email ID
└─ User can manually categorize

Event Extraction Error:
├─ Skip calendar event creation
├─ Include in digest instead
└─ No calendar created

Digest Send Error:
├─ Log error
├─ Don't mark digest as sent in StateStore
├─ User can retry
└─ No duplicate risk (state not persisted)
```

## Performance Considerations

```
Typical Daily Run (50 emails):

 1. Load config          ~10ms
 2. Connect Gmail        ~100ms
 3. Read inbox           ~2s
 4. Classify (50×)       ~100ms
 5. Extract events (10×) ~200ms
 6. Apply labels (50×)   ~1s
 7. Mark as read (15×)   ~500ms
 8. Create events (3×)   ~300ms
 9. Generate digest      ~50ms
10. Send email           ~1s
11. Save state           ~100ms

Total: ~5-6 seconds

Database:
├ Each message insert   ~5ms
├ Digest record insert  ~2ms
└ Token update          ~1ms

Memory footprint: ~20-30 MB

Optimization opportunities:
├─ Batch label applies
├─ Parallel event extraction
├─ Cache classification rules
└─ Reduce API calls
```

## Testing Strategy

```
Unit Tests (vitest):
├─ classifier.test.ts
│  ├─ Test classificationfor all 4 categories
│  ├─ Test confidence scoring
│  └─ Test reason generation
│
├─ event_extractor.test.ts
│  ├─ Test ICS parsing
│  ├─ Test text date extraction
│  ├─ Test timezone handling
│  └─ Test confidence thresholds
│
└─ deduplication.test.ts
   ├─ Test message ID tracking
   ├─ Test digest date matching
   └─ Test idempotency

Integration Tests (future):
├─ Test with real Gmail account (sandbox)
├─ Test with real Google Calendar
├─ Test token refresh flow
├─ Test multi-run idempotency
└─ Test error recovery

Code Coverage Target: 80%+
```
