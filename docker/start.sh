#!/bin/bash
set -e

# Create workspace directory
mkdir -p /root/.openclaw/workspace

# Generate OpenClaw config from environment variables
cat > /root/.openclaw/openclaw.json <<CONF
{
  "gateway": {
    "mode": "local",
    "port": 8080,
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "${MACHINE_SECRET}"
    },
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  },
  "env": {
    "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-sonnet-4-5-20250929"
      },
      "workspace": "/root/.openclaw/workspace"
    },
    "list": [
      {
        "id": "main",
        "default": true,
        "workspace": "/root/.openclaw/workspace"
      }
    ]
  }
}
CONF

echo "OpenClaw config generated for user: ${USER_ID}"
echo "Starting OpenClaw gateway on port 8080..."

export NODE_OPTIONS="--max-old-space-size=768"
exec openclaw gateway --port 8080
