#!/bin/bash

# QMD Search Plugin Installation Script
# Usage: ./install-to-vault.sh /path/to/your/vault

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 /path/to/your/vault"
  echo "Example: $0 ~/Documents/MyObsidianVault"
  exit 1
fi

VAULT_PATH="$1"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/qmd-search"

if [ ! -d "$VAULT_PATH" ]; then
  echo "❌ Error: Vault directory not found: $VAULT_PATH"
  exit 1
fi

echo "📦 Installing QMD Search plugin to: $VAULT_PATH"
echo ""

# Create plugin directory
echo "1️⃣ Creating plugin directory..."
mkdir -p "$PLUGIN_DIR"

# Copy files
echo "2️⃣ Copying plugin files..."
cp main.js "$PLUGIN_DIR/"
echo "   ✅ main.js"

cp sql-wasm.wasm "$PLUGIN_DIR/"
echo "   ✅ sql-wasm.wasm (WASM binary)"

cp manifest.json "$PLUGIN_DIR/"
echo "   ✅ manifest.json"

cp styles.css "$PLUGIN_DIR/"
echo "   ✅ styles.css"

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Reload Obsidian (or restart the app)"
echo "   2. Go to Settings → Community plugins"
echo "   3. Enable 'QMD Search'"
echo "   4. Press Ctrl+Shift+I to open DevTools"
echo "   5. Check Console for: 'Database initialized'"
echo ""
echo "🎯 Quick test:"
echo "   Press Ctrl+Shift+F (Cmd+Shift+F on Mac) to open search"
echo ""
