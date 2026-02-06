#!/bin/bash

# Stop: OpenClaw Monitoring Stack

set -e

echo "🛑 Stopping OpenClaw Monitoring Stack..."
echo ""

# Colors
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Stop services
echo -e "${YELLOW}🐳 Stopping Docker containers...${NC}"
docker-compose -f docker-compose.monitoring.yml down

echo ""
echo -e "${GREEN}✅ OpenClaw Monitoring Stack stopped${NC}"
echo ""
echo -e "${BLUE}💡 To remove volumes and clean up completely, run:${NC}"
echo "   docker-compose -f docker-compose.monitoring.yml down -v"
