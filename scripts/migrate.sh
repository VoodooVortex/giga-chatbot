#!/bin/bash
#
# Database Migration Script
# Run database migrations using Drizzle

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Running database migrations...${NC}"

# Check if running in Docker or locally
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

if command -v npx &> /dev/null; then
    # Run locally
    echo -e "${YELLOW}Running migrations locally...${NC}"
    npx drizzle-kit migrate
else
    # Run in Docker
    echo -e "${YELLOW}Running migrations in Docker...${NC}"
    docker compose exec chatbot npx drizzle-kit migrate
fi

echo -e "${GREEN}Migrations complete!${NC}"
