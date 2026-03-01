#!/bin/bash
#
# Database Migration Script
# Run database migrations using psql for raw SQL files
# Supports: local psql, docker psql, or docker compose exec

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

# Extract host from DATABASE_URL
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\).*/\1/p')
echo -e "${YELLOW}Database host: $DB_HOST${NC}"

# Check if it's a Docker container hostname (contains '-')
IS_DOCKER_HOST=false
if [[ "$DB_HOST" == *-* ]] && [[ "$DB_HOST" != "localhost" ]] && [[ "$DB_HOST" != "127.0.0.1" ]]; then
    IS_DOCKER_HOST=true
fi

# Run SQL migrations in order
MIGRATIONS_DIR="infra/db/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo -e "${RED}Error: Migrations directory not found: $MIGRATIONS_DIR${NC}"
    exit 1
fi

# Function to run migration with psql
run_migration_psql() {
    local migration_file=$1
    if command -v psql &> /dev/null; then
        psql "$DATABASE_URL" -f "$migration_file"
    else
        echo -e "${RED}Error: psql not found${NC}"
        exit 1
    fi
}

# Function to run migration with docker compose
run_migration_compose() {
    local migration_file=$1
    local filename=$(basename "$migration_file")
    
    # Try to use docker compose exec with chatbot service
    # This assumes the chatbot service is running and has psql
    if docker compose ps | grep -q "chatbot"; then
        echo -e "${YELLOW}Using docker compose exec...${NC}"
        # Copy file to container and execute
        docker cp "$migration_file" "giga-chatbot:/tmp/$filename"
        docker compose exec -T chatbot sh -c "psql \"\$DATABASE_URL\" -f /tmp/$filename"
        docker compose exec chatbot rm "/tmp/$filename"
    else
        echo -e "${RED}Error: chatbot service is not running${NC}"
        echo "Please start the services first: docker compose up -d"
        exit 1
    fi
}

# Run each SQL file in order
for migration in $(ls -1 $MIGRATIONS_DIR/*.sql | sort); do
    echo -e "${YELLOW}Applying migration: $(basename $migration)${NC}"
    
    if [ "$IS_DOCKER_HOST" = true ]; then
        # Use docker compose if host is a Docker container
        run_migration_compose "$migration"
    else
        # Use local psql
        run_migration_psql "$migration"
    fi
    
    echo -e "${GREEN}✓ Applied: $(basename $migration)${NC}"
done

echo -e "${GREEN}All migrations complete!${NC}"
