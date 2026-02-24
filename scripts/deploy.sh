#!/bin/bash
#
# Giga Chatbot Deployment Script
# Usage: ./scripts/deploy.sh [environment]
# Example: ./scripts/deploy.sh production

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-production}
COMPOSE_FILE="docker-compose.yml"
NETWORK_NAME="orbis_prod_network"

echo -e "${GREEN}Deploying Giga Chatbot to ${ENVIRONMENT}...${NC}"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please create .env file from .env.example"
    exit 1
fi

# Create external network if it doesn't exist
if ! docker network ls | grep -q "${NETWORK_NAME}"; then
    echo -e "${YELLOW}Creating Docker network: ${NETWORK_NAME}${NC}"
    docker network create ${NETWORK_NAME}
fi

# Pull latest changes
echo -e "${YELLOW}Pulling latest changes...${NC}"
git pull origin main || echo "Not a git repository or already up to date"

# Build and start services
echo -e "${YELLOW}Building and starting services...${NC}"
docker compose -f ${COMPOSE_FILE} build --no-cache
docker compose -f ${COMPOSE_FILE} up -d

# Wait for health check
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 10

# Check health
echo -e "${YELLOW}Checking service health...${NC}"
if curl -f http://localhost:3000/chat/api/healthz > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Giga Chatbot is healthy${NC}"
else
    echo -e "${RED}✗ Giga Chatbot health check failed${NC}"
    docker compose -f ${COMPOSE_FILE} logs --tail=50
    exit 1
fi

# Cleanup old images
echo -e "${YELLOW}Cleaning up old images...${NC}"
docker image prune -f

echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "Services:"
echo "  - Chatbot: http://localhost:3000/chat"
echo "  - Health:  http://localhost:3000/chat/api/healthz"
echo "  - Metrics: http://localhost:3000/api/metrics"
echo ""
echo "View logs: docker compose logs -f"
