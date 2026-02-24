# Giga Chatbot

AI-powered chatbot for Orbis Track - IT Asset Management System with RAG (Retrieval Augmented Generation) capabilities.

## Features

- **AI-Powered Chat**: Powered by Google Gemini with intelligent intent classification
- **RAG System**: Vector-based knowledge retrieval using pgvector and Google Embeddings
- **Real-time Sync**: PostgreSQL LISTEN/NOTIFY for live data updates
- **SSO Integration**: JWT cookie-based authentication shared with Orbis-Track
- **Room-based Chat**: Persistent chat rooms with history
- **Tool Calling**: Query devices, tickets, and notifications via natural language
- **Security**: Rate limiting, CSRF protection, and audit logging
- **Observability**: Structured logging, metrics, and health checks

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Nginx (Reverse Proxy)                    │
│                    Routes /chat to chatbot service              │
└────────────────────┬────────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────▼────────┐      ┌─────────▼──────┐
│  Giga Chatbot  │      │  Orbis-Track   │
│   (Next.js)    │      │   (Main App)   │
│                │      │                │
│  - Chat UI     │      │  - Device DB   │
│  - AI API      │      │  - Ticket DB   │
│  - Auth        │      │  - User Auth   │
└───────┬────────┘      └────────────────┘
        │
        │ Uses shared DB
┌───────▼─────────────────────────────────────────┐
│           PostgreSQL with pgvector              │
│  - chat_rooms, chat_messages, chat_attachments  │
│  - embeddings (vector storage)                  │
│  - RAG triggers (via Orbis-Track)               │
└─────────────────────┬───────────────────────────┘
                      │ LISTEN/NOTIFY
            ┌─────────▼─────────┐
            │   RAG Worker      │
            │  (Separate Proc)  │
            │                   │
            │ - Generate embeds │
            │ - Vector updates  │
            └───────────────────┘
```

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: React + Tailwind CSS + shadcn/ui
- **AI**: Google Gemini (text-embedding-004, gemini-1.5-flash)
- **Database**: PostgreSQL 16 with pgvector
- **ORM**: Drizzle
- **Auth**: JWT (shared secret with Orbis-Track)
- **Deployment**: Docker + Docker Compose

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm
- PostgreSQL 16 with pgvector extension
- Google AI API Key

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd giga-chatbot
```

2. Install dependencies:

```bash
pnpm install
```

3. Copy environment file:

```bash
cp .env.example .env
```

4. Update `.env` with your configuration:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/orbis_track

# Google AI
GOOGLE_API_KEY=your-google-api-key

# JWT (must match Orbis-Track)
JWT_SECRET=your-shared-secret

# Orbis-Track URL
MAIN_APP_URL=http://localhost:3001
```

5. Run database migrations:

```bash
pnpm db:migrate
```

6. Start development server:

```bash
pnpm dev
```

The chatbot will be available at `http://localhost:3000/chat`

## Docker Deployment

### Production Deployment

1. Create external Docker network:

```bash
docker network create orbis_prod_network
```

2. Copy and configure environment:

```bash
cp .env.example .env
# Edit .env with production values
```

3. Deploy:

```bash
./scripts/deploy.sh
```

### Services

| Service | URL                                    | Description         |
| ------- | -------------------------------------- | ------------------- |
| Chatbot | http://localhost:3000/chat             | Main chat interface |
| Health  | http://localhost:3000/chat/api/healthz | Health check        |
| Metrics | http://localhost:3000/api/metrics      | Prometheus metrics  |

## Project Structure

```
giga-chatbot/
├── apps/
│   └── worker/              # RAG Worker (separate container)
│       ├── src/
│       │   ├── config.ts    # Worker configuration
│       │   ├── db.ts        # Database connection
│       │   ├── embedder.ts  # Google Embeddings
│       │   ├── index.ts     # Entry point
│       │   ├── listener.ts  # LISTEN/NOTIFY handler
│       │   ├── queue.ts     # Debounced queue
│       │   └── types.ts     # Type definitions
│       ├── Dockerfile
│       └── package.json
├── infra/
│   ├── db/
│   │   └── migrations/      # Database migrations
│   └── nginx/
│       └── giga-chatbot.conf # Nginx configuration
├── scripts/
│   ├── deploy.sh            # Deployment script
│   ├── migrate.sh           # Migration script
│   └── backup.sh            # Backup script
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── api/             # API Routes
│   │   ├── chat/            # Chat pages
│   │   ├── assistant.tsx    # Assistant component
│   │   └── layout.tsx
│   ├── components/
│   │   ├── assistant-ui/    # Chat UI components
│   │   └── ui/              # shadcn/ui components
│   ├── lib/
│   │   ├── ai/              # AI orchestration
│   │   │   ├── types.ts
│   │   │   ├── intent-classifier.ts
│   │   │   ├── rag-retriever.ts
│   │   │   ├── tools.ts
│   │   │   ├── response-generator.ts
│   │   │   ├── orchestrator.ts
│   │   │   └── index.ts
│   │   ├── api-client.ts    # Orbis-Track API client
│   │   ├── auth/            # Authentication
│   │   ├── config/          # Environment config
│   │   ├── db/              # Database schema
│   │   ├── observability/   # Logging & metrics
│   │   └── security/        # Rate limiting & CSRF
│   └── middleware.ts        # Auth middleware
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## AI Orchestration Flow

```
User Query
    │
    ▼
┌─────────────┐
│   Intent    │  Classify intent (device_lookup, ticket_lookup,
│ Classifier  │  notification_check, general_question)
└──────┬──────┘
       │
       ▼
   ┌───┴───┐
   │       │
   ▼       ▼
┌──────┐ ┌──────┐
│ RAG  │ │Tools │  Parallel execution
│Search│ │ Call │
└──┬───┘ └──┬───┘
   │        │
   ▼        ▼
   └────┬───┘
        │
        ▼
┌───────────────┐
│   Response    │  Generate contextual response with citations
│   Generator   │
└───────────────┘
```

## API Endpoints

### Chat

- `POST /api/chat` - Send message to AI
- `GET /api/chat/rooms` - List chat rooms
- `POST /api/chat/rooms` - Create new room
- `GET /api/chat/rooms/:id/messages` - Get room messages
- `POST /api/chat/rooms/:id/messages` - Add message to room

### Health & Metrics

- `GET /chat/api/healthz` - Health check
- `GET /api/metrics` - Prometheus metrics

### Auth (from Orbis-Track)

- `GET /api/auth/session` - Get current session

## Environment Variables

### Required

| Variable         | Description                                  | Example                                    |
| ---------------- | -------------------------------------------- | ------------------------------------------ |
| `DATABASE_URL`   | PostgreSQL connection string                 | `postgresql://user:pass@localhost:5432/db` |
| `GOOGLE_API_KEY` | Google AI API key                            | `AIza...`                                  |
| `JWT_SECRET`     | JWT signing secret (shared with Orbis-Track) | `min-32-char-secret`                       |
| `MAIN_APP_URL`   | Orbis-Track base URL                         | `http://localhost:3001`                    |

### Optional

| Variable                | Default | Description                       |
| ----------------------- | ------- | --------------------------------- |
| `EMBEDDING_DIMENSION`   | `768`   | Vector dimensions (Google: 768)   |
| `CHUNK_SIZE`            | `512`   | Text chunk size for RAG           |
| `CHUNK_OVERLAP`         | `50`    | Text chunk overlap                |
| `RATE_LIMIT_PER_MINUTE` | `30`    | API rate limit                    |
| `LOG_LEVEL`             | `info`  | Log level (debug/info/warn/error) |
| `LOG_FORMAT`            | `text`  | Log format (text/json)            |

## Database Migrations

Run migrations:

```bash
./scripts/migrate.sh
```

Or using pnpm:

```bash
pnpm db:migrate
```

## Backup

Backup chat data:

```bash
./scripts/backup.sh
```

Backups are stored in `./backups/` with automatic rotation (keeps 7 days).

## Monitoring

### Health Checks

- **Liveness**: `GET /chat/api/healthz`
- **Readiness**: Checks database connectivity

### Metrics

Prometheus metrics available at `/api/metrics`:

- `api_requests_total` - Total API requests
- `api_request_duration_ms` - Request latency
- `chat_messages_total` - Chat messages count
- `worker_jobs_total` - RAG worker jobs
- `ai_requests_total` - AI generation requests

### Logs

Structured JSON logging with context:

- Request ID
- User ID
- Latency
- Error details

## Security

- **Authentication**: JWT cookie verification
- **Authorization**: Role-based access control
- **Rate Limiting**: 30 requests/minute per user
- **CSRF Protection**: Token-based for write operations
- **Audit Logging**: Track all tool calls and AI responses

## Troubleshooting

### Common Issues

1. **Database connection failed**
   - Verify `DATABASE_URL` is correct
   - Ensure pgvector extension is installed
   - Check network connectivity

2. **Authentication errors**
   - Verify `JWT_SECRET` matches Orbis-Track
   - Check cookie name configuration
   - Ensure HTTPS in production

3. **AI not responding**
   - Verify `GOOGLE_API_KEY` is valid
   - Check rate limits on Google AI
   - Review logs for errors

4. **RAG not retrieving context**
   - Ensure RAG worker is running
   - Check embeddings table has data
   - Verify trigger is set up in Orbis-Track DB

### Debug Mode

Enable debug logging:

```env
LOG_LEVEL=debug
LOG_FORMAT=json
```

View logs:

```bash
# Docker
docker compose logs -f chatbot
docker compose logs -f worker

# Local
pnpm dev
```

## License

[License Information]

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Support

For issues and questions:

- GitHub Issues: [link]
- Email: [support email]
