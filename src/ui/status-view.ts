import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { Database } from '../search/fts-search';

export const STATUS_VIEW_TYPE = 'qmd-status-view';

export interface IndexStats {
  totalDocuments: number;
  totalVectors: number;
  lastIndexed: Date | null;
  ollamaConnected: boolean;
  ollamaError: string | null;
  databaseSize: number;
}

export class QMDStatusView extends ItemView {
  private db: Database | null = null;
  private stats: IndexStats = {
    totalDocuments: 0,
    totalVectors: 0,
    lastIndexed: null,
    ollamaConnected: false,
    ollamaError: null,
    databaseSize: 0
  };
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return STATUS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'QMD Status';
  }

  getIcon(): string {
    return 'info';
  }

  setDatabase(db: Database): void {
    this.db = db;
    this.refresh();
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('qmd-status-view');

    this.renderStatus(container);

    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, 5000);
  }

  async onClose(): Promise<void> {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  async refresh(): Promise<void> {
    if (this.db) {
      await this.updateStats();
    }
    const container = this.containerEl.children[1];
    container.empty();
    this.renderStatus(container);
  }

  private async updateStats(): Promise<void> {
    if (!this.db) return;

    try {
      const docCountResult = this.db.exec('SELECT COUNT(*) as count FROM documents');
      const vectorCountResult = this.db.exec('SELECT COUNT(*) as count FROM content_vectors');
      
      this.stats.totalDocuments = docCountResult[0]?.values[0]?.[0] as number || 0;
      this.stats.totalVectors = vectorCountResult[0]?.values[0]?.[0] as number || 0;

      const lastIndexResult = this.db.exec('SELECT MAX(indexed_at) as last FROM documents');
      const lastIndexTimestamp = lastIndexResult[0]?.values[0]?.[0];
      if (lastIndexTimestamp) {
        this.stats.lastIndexed = new Date(lastIndexTimestamp as string);
      }
    } catch (error) {
      console.error('Failed to update stats:', error);
    }
  }

  private renderStatus(container: Element): void {
    container.createEl('h4', { text: 'Index Status', cls: 'qmd-status-header' });

    const statsContainer = container.createDiv('qmd-status-stats');

    this.createStatRow(statsContainer, '📚 Documents', String(this.stats.totalDocuments));
    this.createStatRow(statsContainer, '🔢 Vectors', String(this.stats.totalVectors));
    
    const lastIndexedText = this.stats.lastIndexed 
      ? this.formatRelativeTime(this.stats.lastIndexed)
      : 'Never';
    this.createStatRow(statsContainer, '🕐 Last Indexed', lastIndexedText);

    const ollamaStatusText = this.stats.ollamaConnected ? '✅ Connected' : '❌ Disconnected';
    const ollamaClass = this.stats.ollamaConnected ? 'qmd-status-success' : 'qmd-status-error';
    this.createStatRow(statsContainer, '🤖 Ollama', ollamaStatusText, ollamaClass);

    if (this.stats.ollamaError) {
      const errorContainer = container.createDiv('qmd-status-error-details');
      errorContainer.createEl('strong', { text: 'Error: ' });
      errorContainer.createSpan({ text: this.stats.ollamaError });
    }

    const coveragePercent = this.stats.totalDocuments > 0
      ? ((this.stats.totalVectors / this.stats.totalDocuments) * 100).toFixed(1)
      : '0.0';
    this.createStatRow(statsContainer, '📊 Vector Coverage', `${coveragePercent}%`);
  }

  private createStatRow(container: HTMLElement, label: string, value: string, valueClass?: string): void {
    const row = container.createDiv('qmd-status-row');
    row.createSpan({ text: label, cls: 'qmd-status-label' });
    const valueEl = row.createSpan({ text: value, cls: 'qmd-status-value' });
    if (valueClass) {
      valueEl.addClass(valueClass);
    }
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString();
  }

  updateOllamaStatus(connected: boolean, error: string | null = null): void {
    this.stats.ollamaConnected = connected;
    this.stats.ollamaError = error;
    this.refresh();
  }
}
