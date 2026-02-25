# API Contract Documentation

## Overview

This document describes the API contract between Giga Chatbot and Orbis-Track main application.

## Authentication

All API requests require authentication via JWT cookie.

### Cookie

- **Name**: `token` (configurable via `COOKIE_NAME`)
- **Attributes**: `HttpOnly`, `Secure` (in production), `SameSite=Lax`
- **Domain**: Shared between Orbis-Track and Giga Chatbot

### Session Verification

```http
GET /api/auth/session
```

**Response**:

```json
{
  "message": "Success",
  "data": {
    "user": {
      "sub": 123,
      "role": "user",
      "dept": 1,
      "sec": 2
    },
    "roles": ["user"],
    "exp": 1700000000
  }
}
```

## Orbis-Track API Endpoints

### Devices (Inventory)

#### List Devices

```http
GET /api/v1/inventory?page=1&limit=10&search=laptop&category=1
```

**Response**:

```json
{
  "data": [
    {
      "de_id": 1,
      "de_serial_number": "SN001",
      "de_name": "MacBook Pro",
      "de_description": "14-inch M3 Pro",
      "de_location": "Building A",
      "de_max_borrow_days": 30,
      "de_images": null,
      "de_af_id": 1,
      "de_ca_id": 2,
      "de_us_id": 3,
      "de_sec_id": 1,
      "deleted_at": null,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10
  }
}
```

#### Get Device by ID

```http
GET /api/v1/inventory/devices/:id
```

### Issues (History Issue)

#### List Issues

```http
GET /api/v1/history-issue?page=1&limit=10&status=PENDING&de_id=1
```

**Response**:

```json
{
  "data": [
    {
      "ti_id": 1,
      "ti_de_id": 1,
      "ti_brt_id": null,
      "ti_title": "Screen not working",
      "ti_description": "Display shows artifacts",
      "ti_reported_by": 1,
      "ti_assigned_to": 2,
      "ti_status": "PENDING",
      "ti_result": "IN_PROGRESS",
      "ti_damaged_reason": null,
      "ti_resolved_note": null,
      "receive_at": null,
      "success_at": null,
      "deleted_at": null,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "total": 50,
    "page": 1,
    "limit": 10
  }
}
```

### Notifications

#### Get Notifications

```http
GET /api/v1/notifications?unread=true&limit=20
```

**Response**:

```json
[
  {
    "n_id": 1,
    "n_title": "New Ticket Assigned",
    "n_message": "You have been assigned to ticket #123",
    "n_data": null,
    "n_target_route": "/tickets/123",
    "n_base_event": "ticket.assigned",
    "n_brt_id": null,
    "n_brts_id": null,
    "n_ti_id": 123,
    "created_at": "2024-01-01T00:00:00Z",
    "send_at": null,
    "nr_status": "UNREAD",
    "read_at": null
  }
]
```

#### Mark Notifications as Read

```http
PATCH /api/v1/notifications/read
Content-Type: application/json

{
  "ids": [1, 2, 3]
}
```

## Giga Chatbot API Endpoints

### Chat

#### Send Message

```http
POST /api/chat
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Find devices in Building A" }
  ],
  "roomId": "123"
}
```

**Response**:

```json
{
  "message": "I found 5 devices in Building A...",
  "metadata": {
    "intent": "device_lookup",
    "sources": {
      "tools": [...],
      "rag": [...]
    },
    "requestId": "uuid"
  }
}
```

### Chat Rooms

#### List Rooms

```http
GET /api/chat/rooms
```

**Response**:

```json
{
  "data": [
    {
      "cr_id": 1,
      "cr_title": "Device Inquiry",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### Create Room

```http
POST /api/chat/rooms
Content-Type: application/json

{
  "title": "New Chat"
}
```

#### Get Room Messages

```http
GET /api/chat/rooms/:roomId/messages
```

### Health & Metrics

#### Health Check

```http
GET /chat/api/healthz
```

**Response**:

```json
{
  "status": "healthy",
  "service": "giga-chatbot",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### Metrics (Prometheus)

```http
GET /api/metrics
```

## Error Responses

### Standard Error Format

```json
{
  "error": "ErrorType",
  "message": "Human readable message",
  "code": "ERROR_CODE",
  "requestId": "uuid"
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Rate Limit Exceeded
- `500` - Internal Server Error

## Rate Limiting

- **Limit**: 30 requests per minute per user
- **Headers**:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Remaining requests in window
  - `X-RateLimit-Reset`: Unix timestamp when limit resets
