#!/usr/bin/env bash
set -e

echo "🚀 Setting up Letta Discord multi-agent environment..."

BASE_DIR="/Users/denizyuksel/Desktop/dc/letta-discord-bot-example"
cd "$BASE_DIR"

# ----------------------------
# 1. Install dependencies
# ----------------------------
echo "📦 Installing npm dependencies..."
npm install

# ----------------------------
# 2. Create .env if missing
# ----------------------------
if [ ! -f .env ]; then
  echo "📝 Creating .env file..."

  cat <<EOF > .env
# ----------------------------
# Discord
# ----------------------------
APP_ID=
DISCORD_TOKEN=
PUBLIC_KEY=

DISCORD_CHANNEL_ID=
DISCORD_RESPONSE_CHANNEL_ID=

RESPOND_TO_MENTIONS=true
RESPOND_TO_DMS=false
RESPOND_TO_GENERIC=false

# ----------------------------
# Letta
# ----------------------------
LETTA_API_KEY=
LETTA_BASE_URL=https://api.letta.com

# ----------------------------
# Agents (fill these)
# ----------------------------
AGENT_OSS_120B=
AGENT_OSS_20B=
AGENT_LLAMA_70B=
AGENT_MISTRAL_MEDIUM=
AGENT_MISTRAL_SMALL=
AGENT_HAIKU_3=
AGENT_HAIKU_35=
AGENT_MAVERICK=
EOF

  echo "✅ .env created"
else
  echo "⚠️ .env already exists — skipping"
fi

# ----------------------------
# 3. Create agent registry
# ----------------------------
AGENT_REGISTRY="src/agents.ts"

if [ ! -f "$AGENT_REGISTRY" ]; then
  echo "🧠 Creating agent registry at src/agents.ts..."

  cat <<'EOF' > "$AGENT_REGISTRY"
export const AGENTS = {
  oss120b: process.env.AGENT_OSS_120B!,
  oss20b: process.env.AGENT_OSS_20B!,
  llama70b: process.env.AGENT_LLAMA_70B!,
  mistralMedium: process.env.AGENT_MISTRAL_MEDIUM!,
  mistralSmall: process.env.AGENT_MISTRAL_SMALL!,
  haiku3: process.env.AGENT_HAIKU_3!,
  haiku35: process.env.AGENT_HAIKU_35!,
  maverick: process.env.AGENT_MAVERICK!,
};
EOF

  echo "✅ Agent registry created"
else
  echo "⚠️ Agent registry already exists — skipping"
fi

# ----------------------------
# 4. Build project
# ----------------------------
echo "🔨 Building project..."
npm run build

echo ""
echo "🎉 Setup complete."
echo ""
echo "Next steps:"
echo "1) Fill in .env (Discord + Letta + Agent IDs)"
echo "2) Implement routing logic using src/agents.ts"
echo "3) Run: npm start"
echo ""

