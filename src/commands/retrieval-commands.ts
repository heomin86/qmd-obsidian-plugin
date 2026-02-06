import { Notice, Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type { DocumentIndexer } from '../database/indexer';
import type { HybridSearcher } from '../search/hybrid-search';

class SearchQueryModal extends Modal {
  onSubmit: (query: string, format: 'json' | 'markdown' | 'snippet') => void;

  constructor(
    app: App,
    onSubmit: (query: string, format: 'json' | 'markdown' | 'snippet') => void
  ) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Search Query' });

    let query = '';
    let format: 'json' | 'markdown' | 'snippet' = 'markdown';

    new Setting(contentEl)
      .setName('Query')
      .setDesc('Search query text')
      .addText(text => text
        .setPlaceholder('Enter search query...')
        .onChange(value => { query = value; }));

    new Setting(contentEl)
      .setName('Output format')
      .setDesc('Result format')
      .addDropdown(dropdown => dropdown
        .addOption('markdown', 'Markdown')
        .addOption('json', 'JSON')
        .addOption('snippet', 'Snippet')
        .setValue('markdown')
        .onChange(value => { format = value as any; }));

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Search')
        .setCta()
        .onClick(() => {
          if (!query) {
            new Notice('Query is required');
            return;
          }
          this.close();
          this.onSubmit(query, format);
        }))
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => { this.close(); }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

function formatAsJSON(results: any[]): string {
  return JSON.stringify(results, null, 2);
}

function formatAsMarkdown(results: any[]): string {
  if (results.length === 0) return '# Search Results\n\nNo results found.';
  
  let md = '# Search Results\n\n';
  results.forEach((result, index) => {
    md += `## ${index + 1}. ${result.title}\n\n`;
    md += `**Path**: ${result.path}\n\n`;
    if (result.snippet) {
      md += `**Snippet**: ${result.snippet}\n\n`;
    }
    if (result.normalizedScore !== undefined) {
      md += `**Score**: ${result.normalizedScore.toFixed(2)}\n\n`;
    }
    md += '---\n\n';
  });
  return md;
}

function formatAsSnippet(results: any[]): string {
  if (results.length === 0) return 'No results found.';
  
  return results.map((result, index) => 
    `${index + 1}. ${result.title} (${result.path})\n   ${result.snippet || ''}`
  ).join('\n\n');
}

export function registerRetrievalCommands(
  app: App,
  indexer: DocumentIndexer,
  hybridSearcher: HybridSearcher,
  addCommand: (config: any) => void
): void {

  addCommand({
    id: 'semantic-search',
    name: 'Semantic search with output',
    callback: () => {
      new SearchQueryModal(app, async (query, format) => {
        try {
          const results = await hybridSearcher.search(query, { limit: 10 });
          
          let output: string;
          switch (format) {
            case 'json':
              output = formatAsJSON(results);
              break;
            case 'markdown':
              output = formatAsMarkdown(results);
              break;
            case 'snippet':
              output = formatAsSnippet(results);
              break;
          }

          await navigator.clipboard.writeText(output);
          new Notice(`${results.length} results copied to clipboard as ${format.toUpperCase()}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          new Notice(`Search failed: ${message}`);
          console.error('Semantic search failed:', error);
        }
      }).open();
    }
  });

  addCommand({
    id: 'get-document-context',
    name: 'Get document context',
    callback: async () => {
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) {
        new Notice('No active file');
        return;
      }

      try {
        const doc = await indexer.getDocumentByPath(activeFile.path);
        if (!doc) {
          new Notice('Document not indexed');
          return;
        }

        const context = `
Title: ${doc.title}
Path: ${doc.path}
Hash: ${doc.hash}
Created: ${new Date(doc.createdAt).toLocaleString()}
Updated: ${new Date(doc.updatedAt).toLocaleString()}
        `.trim();

        await navigator.clipboard.writeText(context);
        new Notice('Document context copied to clipboard');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        new Notice(`Failed to get context: ${message}`);
        console.error('Get context failed:', error);
      }
    }
  });
}
