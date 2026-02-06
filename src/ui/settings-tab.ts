import { App, PluginSettingTab, Setting } from 'obsidian';
import type QMDPlugin from '../../main';

export interface QMDSettings {
  ollamaBaseUrl: string;
  ollamaModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  autoIndex: boolean;
  indexOnStartup: boolean;
  indexDebounceMs: number;
  searchLimit: number;
  rrfK: number;
  minBM25Score: number;
  minVectorSimilarity: number;
}

export const DEFAULT_SETTINGS: QMDSettings = {
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama2',
  embeddingModel: 'nomic-embed-text',
  embeddingDimensions: 768,
  autoIndex: true,
  indexOnStartup: true,
  indexDebounceMs: 500,
  searchLimit: 20,
  rrfK: 60,
  minBM25Score: 0,
  minVectorSimilarity: 0
};

export class QMDSettingsTab extends PluginSettingTab {
  plugin: QMDPlugin;

  constructor(app: App, plugin: QMDPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'QMD Search Settings' });

    this.addOllamaSettings(containerEl);
    this.addIndexingSettings(containerEl);
    this.addSearchSettings(containerEl);
  }

  private addOllamaSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Ollama Configuration' });

    new Setting(containerEl)
      .setName('Ollama base URL')
      .setDesc('URL where Ollama server is running')
      .addText(text => text
        .setPlaceholder('http://localhost:11434')
        .setValue(this.plugin.settings.ollamaBaseUrl)
        .onChange(async (value) => {
          this.plugin.settings.ollamaBaseUrl = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Chat model')
      .setDesc('Ollama model for chat and query expansion')
      .addText(text => text
        .setPlaceholder('llama2')
        .setValue(this.plugin.settings.ollamaModel)
        .onChange(async (value) => {
          this.plugin.settings.ollamaModel = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Embedding model')
      .setDesc('Ollama model for generating embeddings')
      .addText(text => text
        .setPlaceholder('nomic-embed-text')
        .setValue(this.plugin.settings.embeddingModel)
        .onChange(async (value) => {
          this.plugin.settings.embeddingModel = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Embedding dimensions')
      .setDesc('Vector embedding dimensions (must match model)')
      .addText(text => text
        .setPlaceholder('768')
        .setValue(String(this.plugin.settings.embeddingDimensions))
        .onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.embeddingDimensions = num;
            await this.plugin.saveSettings();
          }
        }));
  }

  private addIndexingSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Indexing Options' });

    new Setting(containerEl)
      .setName('Auto-index on file changes')
      .setDesc('Automatically reindex files when they are modified')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoIndex)
        .onChange(async (value) => {
          this.plugin.settings.autoIndex = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Index on startup')
      .setDesc('Rebuild index when Obsidian starts')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.indexOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.indexOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Index debounce (ms)')
      .setDesc('Delay before indexing after file change (prevents excessive indexing)')
      .addText(text => text
        .setPlaceholder('500')
        .setValue(String(this.plugin.settings.indexDebounceMs))
        .onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num >= 0) {
            this.plugin.settings.indexDebounceMs = num;
            await this.plugin.saveSettings();
          }
        }));
  }

  private addSearchSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Search Settings' });

    new Setting(containerEl)
      .setName('Default search limit')
      .setDesc('Maximum number of results to return')
      .addText(text => text
        .setPlaceholder('20')
        .setValue(String(this.plugin.settings.searchLimit))
        .onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.searchLimit = num;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('RRF constant (k)')
      .setDesc('Reciprocal Rank Fusion parameter (higher = flatter score distribution)')
      .addText(text => text
        .setPlaceholder('60')
        .setValue(String(this.plugin.settings.rrfK))
        .onChange(async (value) => {
          const num = parseInt(value);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.rrfK = num;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Min BM25 score')
      .setDesc('Minimum BM25 score threshold (0-100, 0 = no filter)')
      .addText(text => text
        .setPlaceholder('0')
        .setValue(String(this.plugin.settings.minBM25Score))
        .onChange(async (value) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0 && num <= 100) {
            this.plugin.settings.minBM25Score = num;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Min vector similarity')
      .setDesc('Minimum vector similarity threshold (0-100, 0 = no filter)')
      .addText(text => text
        .setPlaceholder('0')
        .setValue(String(this.plugin.settings.minVectorSimilarity))
        .onChange(async (value) => {
          const num = parseFloat(value);
          if (!isNaN(num) && num >= 0 && num <= 100) {
            this.plugin.settings.minVectorSimilarity = num;
            await this.plugin.saveSettings();
          }
        }));
  }
}
