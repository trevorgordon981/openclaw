#!/usr/bin/env bash
#
# OpenClaw AWS Gateway Deployment
# One-command setup for an always-on gateway on AWS
#
# Usage:
#   ./scripts/deploy-aws.sh [options]
#
# Options:
#   --instance-type TYPE   EC2 instance type (default: t3.micro)
#   --region REGION        AWS region (default: us-east-1)
#   --key-name NAME        SSH key pair name (required)
#   --name NAME            Instance name tag (default: openclaw-gateway)
#   --slack                Include Slack setup prompts
#   --dry-run              Show what would be done without executing
#
set -euo pipefail

# Defaults
INSTANCE_TYPE="t3.micro"
REGION="us-east-1"
INSTANCE_NAME="openclaw-gateway"
KEY_NAME=""
INCLUDE_SLACK=false
DRY_RUN=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[openclaw]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; }

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --key-name) KEY_NAME="$2"; shift 2 ;;
    --name) INSTANCE_NAME="$2"; shift 2 ;;
    --slack) INCLUDE_SLACK=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      head -20 "$0" | tail -n +2 | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *) error "Unknown option: $1"; exit 1 ;;
  esac
done

# Validate
if [[ -z "$KEY_NAME" ]]; then
  error "SSH key pair name required. Use --key-name YOUR_KEY"
  echo ""
  echo "To create a key pair:"
  echo "  aws ec2 create-key-pair --key-name openclaw --query 'KeyMaterial' --output text > ~/.ssh/openclaw.pem"
  echo "  chmod 400 ~/.ssh/openclaw.pem"
  exit 1
fi

# Check AWS CLI
if ! command -v aws &>/dev/null; then
  error "AWS CLI not found. Install: https://aws.amazon.com/cli/"
  exit 1
fi

# Get latest Amazon Linux 2023 AMI
log "Finding latest Amazon Linux 2023 AMI in $REGION..."
AMI_ID=$(aws ec2 describe-images \
  --region "$REGION" \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text)

if [[ -z "$AMI_ID" || "$AMI_ID" == "None" ]]; then
  error "Could not find Amazon Linux 2023 AMI"
  exit 1
fi
log "Using AMI: $AMI_ID"

# User data script (runs on first boot)
USER_DATA=$(cat <<'USERDATA'
#!/bin/bash
set -e

# Install Node.js 22
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs git

# Create openclaw user
useradd -m -s /bin/bash openclaw
mkdir -p /home/openclaw/.openclaw

# Install OpenClaw globally
npm install -g openclaw@latest

# Generate gateway token
GATEWAY_TOKEN=$(openssl rand -hex 32)
echo "$GATEWAY_TOKEN" > /home/openclaw/.openclaw/gateway-token

# Create config
cat > /home/openclaw/.openclaw/openclaw.json << 'EOF'
{
  "gateway": {
    "bind": "0.0.0.0",
    "port": 18789,
    "auth": {
      "mode": "token"
    }
  },
  "agents": {
    "defaults": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  }
}
EOF

# Set permissions
chown -R openclaw:openclaw /home/openclaw/.openclaw

# Create systemd service
cat > /etc/systemd/system/openclaw-gateway.service << 'EOF'
[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/home/openclaw
Environment=OPENCLAW_STATE_DIR=/home/openclaw/.openclaw
Environment=OPENCLAW_CONFIG_PATH=/home/openclaw/.openclaw/openclaw.json
ExecStart=/usr/bin/openclaw gateway run
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
systemctl daemon-reload
systemctl enable openclaw-gateway
systemctl start openclaw-gateway

# Output connection info
echo "========================================" >> /var/log/openclaw-setup.log
echo "OpenClaw Gateway Setup Complete" >> /var/log/openclaw-setup.log
echo "Gateway Token: $GATEWAY_TOKEN" >> /var/log/openclaw-setup.log
echo "========================================" >> /var/log/openclaw-setup.log
USERDATA
)

# Create security group
log "Creating security group..."
SG_NAME="${INSTANCE_NAME}-sg"

SG_ID=$(aws ec2 describe-security-groups \
  --region "$REGION" \
  --filters "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' \
  --output text 2>/dev/null || echo "None")

if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
  SG_ID=$(aws ec2 create-security-group \
    --region "$REGION" \
    --group-name "$SG_NAME" \
    --description "OpenClaw Gateway security group" \
    --query 'GroupId' \
    --output text)
  
  # Allow SSH
  aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 22 \
    --cidr 0.0.0.0/0
  
  # Allow Gateway WebSocket (restrict to your IP in production!)
  aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 18789 \
    --cidr 0.0.0.0/0
  
  log "Created security group: $SG_ID"
else
  log "Using existing security group: $SG_ID"
fi

if $DRY_RUN; then
  log "DRY RUN - Would create instance with:"
  echo "  AMI: $AMI_ID"
  echo "  Type: $INSTANCE_TYPE"
  echo "  Key: $KEY_NAME"
  echo "  Security Group: $SG_ID"
  exit 0
fi

# Launch instance
log "Launching EC2 instance..."
INSTANCE_ID=$(aws ec2 run-instances \
  --region "$REGION" \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data "$USER_DATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
  --query 'Instances[0].InstanceId' \
  --output text)

log "Instance launched: $INSTANCE_ID"
log "Waiting for instance to be running..."

aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"

# Get public IP
PUBLIC_IP=$(aws ec2 describe-instances \
  --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

log "Instance running at: $PUBLIC_IP"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  OpenClaw Gateway Deployed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Instance ID: $INSTANCE_ID"
echo "Public IP:   $PUBLIC_IP"
echo ""
echo -e "${YELLOW}Wait ~2 minutes for setup to complete, then:${NC}"
echo ""
echo "1. Get your gateway token:"
echo "   ssh -i ~/.ssh/${KEY_NAME}.pem ec2-user@${PUBLIC_IP} 'sudo cat /home/openclaw/.openclaw/gateway-token'"
echo ""
echo "2. Add to your local ~/.openclaw/openclaw.json:"
cat << EOF
   {
     "gateway": {
       "mode": "remote",
       "remote": {
         "url": "ws://${PUBLIC_IP}:18789",
         "token": "<token-from-step-1>"
       }
     }
   }
EOF
echo ""
echo "3. Connect your Mac as a node:"
echo "   openclaw node install --host ${PUBLIC_IP} --port 18789"
echo ""
echo "4. Test connection:"
echo "   openclaw health"
echo ""

if $INCLUDE_SLACK; then
  echo -e "${BLUE}Slack Setup:${NC}"
  echo "   SSH into the instance and run:"
  echo "   sudo -u openclaw openclaw channels add --channel slack"
  echo ""
fi

echo "Docs: https://docs.openclaw.ai/gateway/remote"
