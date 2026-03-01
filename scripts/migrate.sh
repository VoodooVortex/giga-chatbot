#!/bin/bash
#
# Database Migration Script
# Run database migrations using psql for raw SQL files

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Running database migrations...${NC}"

# Load environment variables from .env if exists
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

if [ -f ".env.local" ]; then
    export $(cat .env.local | grep -v '^#' | xargs)
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL is not set${NC}"
    echo "Please set DATABASE_URL in .env or .env.local"
    exit 1
fi

# Run SQL migrations in order
MIGRATIONS_DIR="infra/db/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo -e "${RED}Error: Migrations directory not found: $MIGRATIONS_DIR${NC}"
    exit 1
fi

# Run each SQL file in order
for migration in $(ls -1 $MIGRATIONS_DIR/*.sql | sort); do
    echo -e "${YELLOW}Applying migration: $(basename $migration)${NC}"
    
    if command -v psql &> /dev/null; then
        # Run with psql locally
        psql "$DATABASE_URL" -f "$migration"
    elif command -v docker &> /dev/null; then
        # Run with psql in Docker
        docker run --rm -i \
            -e PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's/.*:\([^@]*\)@.*/\1/p') \
            postgres:16-alpine \
            psql "$DATABASE_URL" < "$migration"
    else
        echo -e "${RED}Error: psql or docker is required to run migrations${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Applied: $(basename $migration)${NC}"
done

echo -e "${GREEN}All migrations complete!${NC}"
