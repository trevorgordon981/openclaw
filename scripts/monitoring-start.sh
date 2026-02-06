#!/bin/bash

# Quick Start: OpenClaw Monitoring Stack (Prometheus + Grafana + AlertManager)

set -e

echo "🚀 Starting OpenClaw Monitoring Stack..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo "Install from: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    echo "Install from: https://docs.docker.com/compose/install/"
    exit 1
fi

echo -e "${BLUE}✓ Docker and Docker Compose found${NC}"
echo ""

# Create required directories
echo -e "${YELLOW}📁 Creating directories...${NC}"
mkdir -p grafana/provisioning/{dashboards,datasources}
mkdir -p prometheus
mkdir -p alertmanager

# Copy dashboard
echo -e "${YELLOW}📊 Setting up Grafana dashboard...${NC}"
if [ -f "grafana/openclaw-optimization-dashboard.json" ]; then
    cp grafana/openclaw-optimization-dashboard.json grafana/provisioning/dashboards/
    echo -e "${GREEN}✓ Dashboard configured${NC}"
else
    echo -e "${YELLOW}⚠️  Dashboard JSON not found, will create empty dashboards folder${NC}"
fi

# Load environment variables
if [ -f ".env.monitoring" ]; then
    echo -e "${YELLOW}📝 Loading environment variables from .env.monitoring${NC}"
    export $(cat .env.monitoring | grep -v '^#' | xargs)
else
    echo -e "${YELLOW}⚠️  .env.monitoring not found, using defaults${NC}"
fi

# Check if OpenClaw metrics server is reachable
echo ""
echo -e "${BLUE}🔍 Checking OpenClaw metrics server...${NC}"
OPENCLAW_HOST=${OPENCLAW_METRICS_HOST:-host.docker.internal}
OPENCLAW_PORT=${OPENCLAW_METRICS_PORT:-9090}

if nc -z "$OPENCLAW_HOST" "$OPENCLAW_PORT" 2>/dev/null; then
    echo -e "${GREEN}✓ OpenClaw metrics server is reachable at $OPENCLAW_HOST:$OPENCLAW_PORT${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: OpenClaw metrics server not reachable at $OPENCLAW_HOST:$OPENCLAW_PORT${NC}"
    echo "   Make sure OpenClaw has initialized the Prometheus exporter"
    echo "   Update OPENCLAW_METRICS_HOST in .env.monitoring if needed"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Start services
echo ""
echo -e "${BLUE}🐳 Starting Docker containers...${NC}"
docker-compose -f docker-compose.monitoring.yml up -d

# Wait for services to be ready
echo ""
echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
sleep 5

# Check service health
echo ""
echo -e "${BLUE}🏥 Checking service health...${NC}"

services=(
    "Prometheus:http://localhost:9091/-/healthy"
    "Grafana:http://localhost:3000/api/health"
    "AlertManager:http://localhost:9093/-/healthy"
)

for service in "${services[@]}"; do
    IFS=':' read -r name url <<< "$service"
    if curl -s -f "$url" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ $name is healthy${NC}"
    else
        echo -e "${YELLOW}⏳ Waiting for $name to be ready...${NC}"
        sleep 5
        if curl -s -f "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ $name is healthy${NC}"
        else
            echo -e "${YELLOW}⚠️  $name may still be starting${NC}"
        fi
    fi
done

echo ""
echo -e "${GREEN}✅ OpenClaw Monitoring Stack is running!${NC}"
echo ""
echo -e "${BLUE}📊 Access Services:${NC}"
echo -e "  Grafana:        ${GREEN}http://localhost:3000${NC} (admin/admin)"
echo -e "  Prometheus:     ${GREEN}http://localhost:9091${NC}"
echo -e "  AlertManager:   ${GREEN}http://localhost:9093${NC}"
echo ""
echo -e "${BLUE}📝 Next Steps:${NC}"
echo "  1. Open http://localhost:3000 in your browser"
echo "  2. Log in with admin/admin"
echo "  3. Go to Dashboards → Search 'OpenClaw'"
echo "  4. View token savings and performance metrics"
echo ""
echo -e "${BLUE}🔧 Configuration:${NC}"
echo "  Edit .env.monitoring to update settings"
echo "  Edit prometheus.yml to change scrape targets"
echo "  Edit alertmanager/alertmanager.yml to configure Slack webhooks"
echo ""
echo -e "${BLUE}📖 Documentation:${NC}"
echo "  GRAFANA_SETUP_GUIDE.md - Complete setup and troubleshooting"
echo ""
echo -e "${YELLOW}💡 Tip: Run './scripts/monitoring-stop.sh' to stop the stack${NC}"
