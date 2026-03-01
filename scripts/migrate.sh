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
# Pattern: stop at : (port) or / (database name)
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:/]*\).*/\1/p')
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

# Function to run migration with docker exec (database container)
run_migration_docker() {
    local migration_file=$1
    local db_container=$2
    
    echo -e "${YELLOW}Using docker exec with database container: $db_container${NC}"
    
    if docker ps | grep -q "$db_container"; then
        # Extract database name from DATABASE_URL
        DB_NAME=$(echo "$DATABASE_URL" | sed -n 's/.*\/\([^\/]*\)$/\1/p')
        DB_USER=$(echo "$DATABASE_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
        
        docker exec -i "$db_container" psql -U "${DB_USER:-404}" -d "${DB_NAME:-orbis_track}" < "$migration_file"
    else
        echo -e "${RED}Error: Database container $db_container not found${NC}"
        echo "Please ensure the database container is running."
        exit 1
    fi
}

# Run each SQL file in order
for migration in $(ls -1 $MIGRATIONS_DIR/*.sql | sort); do
    echo -e "${YELLOW}Applying migration: $(basename $migration)${NC}"
    
    if [ "$IS_DOCKER_HOST" = true ]; then
        # Use docker exec with the database container
        DB_CONTAINER=$(echo "$DB_HOST" | sed 's/:.*//')
        run_migration_docker "$migration" "$DB_CONTAINER"
    else
        # Use local psql
        run_migration_psql "$migration"
    fi
    
    echo -e "${GREEN}✓ Applied: $(basename $migration)${NC}"
done

echo -e "${GREEN}All migrations complete!${NC}"

# ============================================================================
# Initial RAG Indexing (Trigger worker to process existing data)
# ============================================================================
echo ""
echo -e "${YELLOW}Triggering RAG re-index for existing data...${NC}"
echo -e "${YELLOW}This will notify the RAG worker to create embeddings for existing records.${NC}"

# SQL to trigger re-index by updating timestamps
rag_sql=$(cat << 'EOF'
-- Trigger RAG re-index for existing devices
UPDATE devices SET updated_at = NOW()
WHERE de_id IN (SELECT de_id FROM devices);

-- Trigger RAG re-index for existing ticket issues
UPDATE ticket_issues SET updated_at = NOW()
WHERE ti_id IN (SELECT ti_id FROM ticket_issues);
EOF
)

# Run RAG re-index SQL
if [ "$IS_DOCKER_HOST" = true ]; then
    # Use docker exec with the database container
    # Extract database container name from DB_HOST (remove port if exists)
    DB_CONTAINER=$(echo "$DB_HOST" | sed 's/:.*//')
    echo -e "${YELLOW}Using database container: $DB_CONTAINER${NC}"
    
    if docker ps | grep -q "$DB_CONTAINER"; then
        echo "$rag_sql" | docker exec -i "$DB_CONTAINER" psql -U 404 -d orbis_track
        echo -e "${GREEN}✓ RAG re-index triggered!${NC}"
    else
        echo -e "${RED}Warning: Database container $DB_CONTAINER not found${NC}"
        echo "Please ensure the database container is running."
    fi
else
    # Use local psql
    if command -v psql &> /dev/null; then
        echo "$rag_sql" | psql "$DATABASE_URL"
        echo -e "${GREEN}✓ RAG re-index triggered!${NC}"
    else
        echo -e "${RED}Warning: psql not found, skipping RAG re-index${NC}"
    fi
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Ensure RAG Worker is running: docker compose up -d worker"
echo "  2. Worker will process embeddings asynchronously"
echo "  3. Check worker logs: docker compose logs -f worker"
echo ""
