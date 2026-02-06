# Testing Guide for QMD Search Plugin

## Quick Installation (Manual Testing)

### Step 1: Locate Your Test Vault
Find your Obsidian test vault's plugins directory:
```
<your-vault>/.obsidian/plugins/
```

### Step 2: Create Plugin Directory
```bash
mkdir -p <your-vault>/.obsidian/plugins/qmd-search
```

### Step 3: Copy Build Files
Copy these 4 files from the build directory to your vault:

```bash
cp /Users/heomin/qmd-obsidian-plugin/main.js <vault>/.obsidian/plugins/qmd-search/
cp /Users/heomin/qmd-obsidian-plugin/manifest.json <vault>/.obsidian/plugins/qmd-search/
cp /Users/heomin/qmd-obsidian-plugin/styles.css <vault>/.obsidian/plugins/qmd-search/
cp /Users/heomin/qmd-obsidian-plugin/sql-wasm.wasm <vault>/.obsidian/plugins/qmd-search/
```

**IMPORTANT**: You MUST copy `sql-wasm.wasm` - the plugin won't work without it!

### Step 4: Enable Plugin
1. Open Obsidian
2. Go to Settings → Community plugins
3. Click "Reload plugins" or restart Obsidian
4. Enable "QMD Search"

### Step 5: Verify Installation
1. Open DevTools (Ctrl+Shift+I or Cmd+Option+I)
2. Go to Console tab
3. Look for these messages:
   - ✅ `"Database initialized"` or `"Database loaded from storage"`
   - ✅ `"QMD Search plugin loaded"`
   - ❌ If you see `"Failed to initialize database"`, the WASM file is missing or not loading

## Testing Checklist

### 1. Database Initialization
- [ ] Plugin loads without errors
- [ ] Console shows "Database initialized" or "Database loaded from storage"
- [ ] No "Failed to initialize database" error

### 2. Basic Search
- [ ] Press `Ctrl+Shift+F` (or `Cmd+Shift+F` on Mac)
- [ ] Search modal opens
- [ ] Type a search query
- [ ] Results appear (if you have indexed documents)

### 3. Indexing Commands
Open Command Palette (`Ctrl/Cmd+P`) and test:
- [ ] "QMD: Reindex all documents" - should show progress modal
- [ ] Check console for indexing progress
- [ ] After completion, run a search to verify indexed content

### 4. Collection Commands
- [ ] "QMD: Create collection" - creates a new collection
- [ ] "QMD: List collections" - shows all collections
- [ ] "QMD: Delete collection" - removes a collection

### 5. Maintenance Commands
- [ ] "QMD: Show database statistics" - displays DB stats
- [ ] "QMD: Optimize database (VACUUM)" - optimizes DB
- [ ] "QMD: Check database health" - shows health metrics

### 6. Context Menu Actions
- [ ] Right-click a file → "Reindex this file"
- [ ] Right-click in editor → "Search selection" (when text is selected)

### 7. File Watcher (Automatic Indexing)
- [ ] Create a new note - should auto-index after 500ms
- [ ] Modify an existing note - should auto-reindex
- [ ] Delete a note - should remove from index
- [ ] Rename a note - should update index

## Development Setup (Hot Reload)

For faster development iteration:

### Option 1: Symlink (Recommended)
```bash
# From plugin directory
ln -s /Users/heomin/qmd-obsidian-plugin <vault>/.obsidian/plugins/qmd-search

# Start watch mode
cd /Users/heomin/qmd-obsidian-plugin
npm run dev
```

After each save, reload the plugin:
- Open Command Palette → "Reload app without saving"
- Or use the Hot Reload plugin

### Option 2: Manual Copy Script
Create a shell script to copy files after each build:

```bash
#!/bin/bash
VAULT="<your-vault-path>"
cp main.js "$VAULT/.obsidian/plugins/qmd-search/"
cp sql-wasm.wasm "$VAULT/.obsidian/plugins/qmd-search/"
echo "✅ Files copied. Reload Obsidian plugin."
```

## Troubleshooting

### "Failed to initialize database"
**Cause**: WASM file not found or not loading

**Solutions**:
1. Verify `sql-wasm.wasm` exists in plugin directory
2. Check file permissions (should be readable)
3. Open DevTools → Network tab → look for WASM load errors
4. Check Console for detailed error messages

### "Module not found" errors
**Cause**: Missing dependencies or incorrect import paths

**Solutions**:
1. Run `npm install` in plugin directory
2. Rebuild: `npm run build`
3. Check that all 4 files are copied to vault

### Search returns no results
**Cause**: Documents not indexed yet

**Solutions**:
1. Run "QMD: Reindex all documents" command
2. Wait for indexing to complete (check console)
3. Try searching again

### Plugin doesn't appear in Community Plugins
**Cause**: Missing manifest.json or incorrect directory structure

**Solutions**:
1. Verify directory: `<vault>/.obsidian/plugins/qmd-search/`
2. Verify manifest.json exists in that directory
3. Restart Obsidian
4. Check Settings → Community plugins → Reload plugins

## Debug Mode

Enable verbose logging:
1. Open DevTools Console
2. Run: `localStorage.setItem('qmd-debug', 'true')`
3. Reload plugin
4. Check console for detailed debug logs

To disable:
```javascript
localStorage.removeItem('qmd-debug');
```

## Expected Console Output (Success)

```
QMD Search plugin loading...
Database initialized
Embedder initialized with model: nomic-embed-text
CollectionManager initialized
DocumentIndexer initialized
QMD Search plugin loaded
File watcher started
Commands registered: 11
```

## Performance Benchmarks

For a vault with 500 notes (~500KB total):
- Initial indexing: ~5-10 seconds
- Search query: <100ms
- Database size: ~2-5MB

For a vault with 2000 notes (~2MB total):
- Initial indexing: ~20-30 seconds
- Search query: <200ms
- Database size: ~10-20MB

## Next Steps After Successful Testing

Once all tests pass:
1. Test with your actual vault (not just a test vault)
2. Try edge cases (very long documents, special characters, etc.)
3. Test performance with large vaults
4. Report any issues or unexpected behavior

## Known Limitations

- Desktop only (no mobile support)
- Vector search requires local Ollama installation (optional)
- Large vaults (>5000 notes) may have slower initial indexing
- Database stored in memory, persisted to disk on save
