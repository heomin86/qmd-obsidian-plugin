# QMD Search

A hybrid search engine for Obsidian combining BM25, vector search, and LLM capabilities.

## Features

- **BM25 Search**: Fast full-text search with relevance ranking
- **Vector Search**: Semantic search using embeddings
- **LLM Integration**: AI-powered search refinement
- **Desktop Optimized**: Leverages SQLite WASM for efficient indexing

## Installation

### From GitHub Releases

1. Download the latest release from [GitHub Releases](https://github.com/qmd-search/qmd-search/releases)
2. Extract **all 4 files** to your vault's `.obsidian/plugins/qmd-search/` directory:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `sql-wasm.wasm` ⚠️ **Required** - plugin won't work without this!
3. Reload Obsidian or restart the app
4. Enable the plugin in Settings → Community plugins

### From Source

```bash
git clone https://github.com/qmd-search/qmd-search.git
cd qmd-search
npm install
npm run build
```

Then copy the plugin folder to your vault's `.obsidian/plugins/` directory.

## Development

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

## Requirements

- Obsidian 1.0.0 or higher
- Desktop app (not supported on mobile)

## License

MIT
