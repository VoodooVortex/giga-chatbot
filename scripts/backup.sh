#!/bin/bash
#
# Database Backup Script
# Creates backups of the chat-related tables

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/giga_chatbot_backup_${DATE}.sql"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Create backup directory
mkdir -p "${BACKUP_DIR}"

echo -e "${YELLOW}Creating database backup...${NC}"

# Extract database connection from DATABASE_URL
# Expected format: postgresql://user:password@host:port/database
if [ -z "${DATABASE_URL}" ]; then
    if [ -f ".env" ]; then
        export $(cat .env | grep DATABASE_URL | xargs)
    fi
fi

# Parse connection string
DB_URL="${DATABASE_URL}"
DB_NAME=$(echo $DB_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

echo "Backing up database: ${DB_NAME}"

# Run pg_dump
if command -v pg_dump &> /dev/null; then
    pg_dump \
        --dbname="${DB_URL}" \
        --table="chat_rooms" \
        --table="chat_messages" \
        --table="chat_attachments" \
        --table="embeddings" \
        --file="${BACKUP_FILE}"
else
    echo -e "${YELLOW}pg_dump not found, trying Docker...${NC}"
    docker compose exec -T chatbot pg_dump \
        --dbname="${DB_URL}" \
        --table="chat_rooms" \
        --table="chat_messages" \
        --table="chat_attachments" \
        --table="embeddings" > "${BACKUP_FILE}"
fi

# Compress backup
gzip "${BACKUP_FILE}"

echo -e "${GREEN}Backup created: ${BACKUP_FILE}.gz${NC}"

# Clean up old backups (keep last 7 days)
find "${BACKUP_DIR}" -name "giga_chatbot_backup_*.sql.gz" -mtime +7 -delete

echo -e "${GREEN}Backup complete!${NC}"
