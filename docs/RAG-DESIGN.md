# RAG (Retrieval Augmented Generation) Design Document

## Overview

Giga Chatbot uses RAG to enhance AI responses with relevant information from the knowledge base. This document describes the RAG architecture and implementation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Data Sources                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Device Docs  │  │ Ticket Data  │  │  Policies    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼─────────────────┼─────────────────┼──────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  RAG Worker (Async)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. LISTEN to rag_update channel                     │  │
│  │  2. Debounce rapid changes (500ms)                   │  │
│  │  3. Chunk text (512 chars, 50 overlap)              │  │
│  │  4. Generate embeddings (Google text-embedding-004) │  │
│  │  5. Store in pgvector (768 dimensions)              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Vector Database (pgvector)                 │
│                                                             │
│  Table: embeddings                                          │
│  - re_id (PK)                                               │
│  - re_source_table (devices, tickets, policies)            │
│  - re_source_pk                                            │
│  - re_content (chunked text)                               │
│  - re_embedding (vector(768))                              │
│  - HNSW index for fast similarity search                   │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
┌─────────────────────┐      ┌──────────────────────┐
│   User Query        │      │   Vector Search      │
│   "How to reset     │─────▶│   - Cosine similarity│
│    password?"       │      │   - Top 5 results    │
└─────────────────────┘      └──────────┬───────────┘
                                        │
                                        ▼
                              ┌──────────────────────┐
                              │   Context Assembly   │
                              │   - Relevant chunks  │
                              │   - Source citations │
                              └──────────┬───────────┘
                                         │
                                         ▼
                              ┌──────────────────────┐
                              │   Gemini Response    │
                              │   - Grounded answer  │
                              │   - Citations        │
                              └──────────────────────┘
```

## Components

### 1. RAG Worker

**Location**: `apps/worker/`

**Responsibilities**:

- Listen to PostgreSQL NOTIFY events
- Process data changes asynchronously
- Generate and update embeddings
- Handle retries and errors

**Configuration**:

```typescript
{
  debounceMs: 500,        // Wait for batching changes
  chunkSize: 512,         // Characters per chunk
  chunkOverlap: 50,       // Overlap between chunks
  concurrency: 5,         // Parallel processing
  maxRetries: 3,          // Retry failed jobs
  retryDelayMs: 5000      // Delay between retries
}
```

### 2. Text Chunking

**Strategy**: Fixed-size with overlap

```typescript
// Example: chunkSize=512, overlap=50
// Text: "The quick brown fox jumps over the lazy dog..."
// Chunk 1: "The quick brown fox jumps over the lazy dog..." (0-512)
// Chunk 2: "dog... [next 462 chars]" (462-974)
```

**Why this approach**:

- Simple and fast
- Maintains local context via overlap
- Works well with semantic search

### 3. Embedding Model

**Provider**: Google AI
**Model**: text-embedding-004
**Dimensions**: 768
**Language**: Multilingual (English + Thai)

**Advantages**:

- Free tier available
- 768D (smaller than OpenAI 1536D)
- Good performance on technical documents

### 4. Vector Storage

**Database**: PostgreSQL with pgvector
**Index**: HNSW (Hierarchical Navigable Small World)
**Distance Metric**: Cosine similarity

**Why HNSW**:

- Fast approximate nearest neighbor search
- Good balance of speed vs accuracy
- Supports high-dimensional vectors

## Data Flow

### When Data Changes

1. **Orbis-Track** updates data (device, ticket, etc.)
2. **Trigger** fires NOTIFY on `rag_update` channel
3. **RAG Worker** receives notification
4. **Debouncer** batches rapid changes
5. **Chunker** splits content into chunks
6. **Embedder** generates vectors
7. **Store** updates embeddings table

### When User Queries

1. **Intent Classifier** determines if RAG needed
2. **Query Embedding** generated from user input
3. **Vector Search** finds similar chunks (cosine similarity)
4. **Hybrid Search** (optional) combines keyword matching
5. **Context Builder** assembles top-K results
6. **Response Generator** uses context + Gemini
7. **Citation** added to response

## Prompt Engineering

### RAG Context Format

```
Retrieved Knowledge Base Context:
[1] Source: policies:policy-001 (Similarity: 92.3%)
Content: Password reset instructions...

[2] Source: devices:device-123 (Similarity: 87.1%)
Content: Device troubleshooting guide...

User Query: How do I reset my password?

Response:
```

### Guidelines

1. **Cite Sources**: Always reference source documents
2. **Confidence Threshold**: Only use results with >70% similarity
3. **Context Window**: Top 5 results max to avoid token limits
4. **Fallback**: If no relevant context found, say so honestly

## Performance Considerations

### Indexing

```sql
-- HNSW index for fast similarity search
CREATE INDEX embeddings_embedding_idx ON embeddings
USING hnsw (re_embedding vector_cosine_ops);
```

### Query Optimization

```sql
-- Efficient similarity query
SELECT *, 1 - (re_embedding <=> query_vector) as similarity
FROM embeddings
WHERE 1 - (re_embedding <=> query_vector) > 0.7
ORDER BY similarity DESC
LIMIT 5;
```

### Caching

- Vector search results cached per query (5 min TTL)
- Embeddings cached in memory (LRU eviction)
- Database connection pooling (min: 2, max: 10)

## Monitoring

### Key Metrics

- `rag_query_latency_ms` - Vector search latency
- `rag_context_retrieved` - Contexts found per query
- `rag_similarity_avg` - Average similarity score
- `worker_queue_size` - Pending embedding jobs
- `worker_jobs_duration_ms` - Processing time

### Alerting Thresholds

- Query latency > 500ms (warning)
- Worker queue > 100 (critical)
- Failed jobs > 5% (critical)

## Security

- Vector data isolated per source table
- No PII in embeddings
- Audit logging for all retrievals
- Rate limiting on AI endpoints

## Future Improvements

1. **Re-ranking**: Cross-encoder for better result ordering
2. **Query Expansion**: Generate synonyms for better recall
3. **Metadata Filtering**: Filter by department, category
4. **Incremental Updates**: Only changed fields, not full re-index
5. **Multi-modal**: Support for image embeddings
