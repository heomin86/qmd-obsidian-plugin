import { App, Modal } from 'obsidian';
import { HybridSearcher, type HybridSearchResult } from '../search/hybrid-search';
import { FTSSearcher, type SearchResult } from '../search/fts-search';
import { VectorSearcher, type VectorSearchResult } from '../search/vector-search';
import type { Database } from '../search/fts-search';
import type { OllamaEmbedder } from '../embeddings/embedder';

type SearchMode = 'hybrid' | 'bm25' | 'vector';

export class QMDSearchModal extends Modal {
  private hybridSearcher: HybridSearcher;
  private ftsSearcher: FTSSearcher;
  private vectorSearcher: VectorSearcher;

  private searchInputEl: HTMLInputElement | null = null;
  private resultsContainerEl: HTMLElement | null = null;
  private activeTab: SearchMode = 'hybrid';
  private currentResults: (HybridSearchResult | SearchResult | VectorSearchResult)[] = [];
  private selectedIndex = 0;
  private searchTimeout: NodeJS.Timeout | null = null;
  private isSearching = false;

  constructor(app: App, db: Database, embedder: OllamaEmbedder) {
    super(app);
    this.hybridSearcher = new HybridSearcher(db, embedder);
    this.ftsSearcher = new FTSSearcher(db);
    this.vectorSearcher = new VectorSearcher(db, embedder);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('qmd-search-modal');

    contentEl.createEl('h2', { text: 'QMD Search' });

    this.searchInputEl = contentEl.createEl('input', {
      type: 'text',
      placeholder: 'Search your vault...',
      cls: 'qmd-search-input'
    });
    this.searchInputEl.focus();

    const tabsContainer = contentEl.createDiv('qmd-search-tabs');
    this.createTab(tabsContainer, 'hybrid', 'Hybrid', true);
    this.createTab(tabsContainer, 'bm25', 'BM25', false);
    this.createTab(tabsContainer, 'vector', 'Vector', false);

    this.resultsContainerEl = contentEl.createDiv('qmd-search-results');

    this.searchInputEl.addEventListener('input', () => this.handleInput());
    this.searchInputEl.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
  }

  private createTab(container: HTMLElement, mode: SearchMode, label: string, active: boolean): void {
    const tab = container.createDiv({
      cls: `qmd-search-tab${active ? ' qmd-search-tab-active' : ''}`
    });
    tab.textContent = label;
    tab.addEventListener('click', () => this.switchTab(mode));
  }

  private switchTab(mode: SearchMode): void {
    this.activeTab = mode;
    
    const tabs = this.contentEl.querySelectorAll('.qmd-search-tab');
    tabs.forEach((tab, index) => {
      const modes: SearchMode[] = ['hybrid', 'bm25', 'vector'];
      if (modes[index] === mode) {
        tab.addClass('qmd-search-tab-active');
      } else {
        tab.removeClass('qmd-search-tab-active');
      }
    });

    const query = this.searchInputEl?.value.trim() || '';
    if (query) {
      this.executeSearch(query);
    }
  }

  private handleInput(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    const query = this.searchInputEl?.value.trim() || '';
    if (!query) {
      this.clearResults();
      return;
    }

    this.searchTimeout = setTimeout(() => {
      this.executeSearch(query);
    }, 300);
  }

  private async executeSearch(query: string): Promise<void> {
    if (this.isSearching) return;
    
    this.isSearching = true;
    this.showLoading();

    try {
      let results: (HybridSearchResult | SearchResult | VectorSearchResult)[];

      switch (this.activeTab) {
        case 'hybrid':
          results = await this.hybridSearcher.search(query, { limit: 20 });
          break;
        case 'bm25':
          results = await this.ftsSearcher.search(query, { limit: 20 });
          break;
        case 'vector':
          results = await this.vectorSearcher.search(query, { limit: 20 });
          break;
      }

      this.currentResults = results;
      this.selectedIndex = 0;
      this.renderResults();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'Search failed');
      console.error('Search error:', error);
    } finally {
      this.isSearching = false;
    }
  }

  private showLoading(): void {
    if (!this.resultsContainerEl) return;
    this.resultsContainerEl.empty();
    this.resultsContainerEl.createDiv({
      cls: 'qmd-search-loading',
      text: 'Searching...'
    });
  }

  private showError(message: string): void {
    if (!this.resultsContainerEl) return;
    this.resultsContainerEl.empty();
    this.resultsContainerEl.createDiv({
      cls: 'qmd-search-error',
      text: `Error: ${message}`
    });
  }

  private clearResults(): void {
    if (!this.resultsContainerEl) return;
    this.resultsContainerEl.empty();
    this.currentResults = [];
    this.selectedIndex = 0;
  }

  private renderResults(): void {
    if (!this.resultsContainerEl) return;
    this.resultsContainerEl.empty();

    if (this.currentResults.length === 0) {
      this.resultsContainerEl.createDiv({
        cls: 'qmd-search-empty',
        text: 'No results found. Try a different query.'
      });
      return;
    }

    this.currentResults.forEach((result, index) => {
      const resultEl = this.resultsContainerEl!.createDiv({
        cls: `qmd-search-result-item${index === this.selectedIndex ? ' qmd-search-result-selected' : ''}`
      });

      const titleEl = resultEl.createDiv({ cls: 'qmd-search-result-title' });
      titleEl.createSpan({ cls: 'qmd-search-result-icon', text: '📄' });
      titleEl.createSpan({ text: result.title });

      const snippetEl = resultEl.createDiv({ cls: 'qmd-search-result-snippet' });
      snippetEl.innerHTML = this.getSnippet(result);

      const scoresEl = resultEl.createDiv({ cls: 'qmd-search-result-scores' });
      scoresEl.textContent = this.formatScores(result);

      const pathEl = resultEl.createDiv({ cls: 'qmd-search-result-path' });
      pathEl.textContent = result.path;

      resultEl.addEventListener('click', () => this.openResult(result));
      resultEl.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.renderResults();
      });
    });
  }

  private getSnippet(result: HybridSearchResult | SearchResult | VectorSearchResult): string {
    if ('snippet' in result && result.snippet) {
      return result.snippet;
    }
    return result.content.slice(0, 200) + '...';
  }

  private formatScores(result: HybridSearchResult | SearchResult | VectorSearchResult): string {
    if (this.activeTab === 'hybrid' && 'normalizedScore' in result) {
      const parts = [`RRF: ${result.normalizedScore.toFixed(1)}`];
      if (result.bm25Rank && result.bm25Score !== undefined) {
        parts.push(`BM25: #${result.bm25Rank} (${result.bm25Score.toFixed(1)})`);
      }
      if (result.vectorRank && result.similarity !== undefined) {
        parts.push(`Vector: #${result.vectorRank} (${result.similarity.toFixed(1)})`);
      }
      return parts.join(' | ');
    } else if (this.activeTab === 'bm25' && 'score' in result && !('similarity' in result)) {
      return `Score: ${result.score.toFixed(1)} | Rank: #${result.rank}`;
    } else if (this.activeTab === 'vector' && 'similarity' in result && !('normalizedScore' in result)) {
      const vectorResult = result as VectorSearchResult;
      return `Similarity: ${vectorResult.similarity.toFixed(1)} | Rank: #${vectorResult.rank}`;
    }
    return '';
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.close();
      return;
    }

    if (this.currentResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.currentResults.length;
      this.renderResults();
      this.scrollToSelected();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = this.selectedIndex === 0 
        ? this.currentResults.length - 1 
        : this.selectedIndex - 1;
      this.renderResults();
      this.scrollToSelected();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = this.currentResults[this.selectedIndex];
      if (selected) {
        this.openResult(selected);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const modes: SearchMode[] = ['hybrid', 'bm25', 'vector'];
      const currentIndex = modes.indexOf(this.activeTab);
      const nextIndex = (currentIndex + 1) % modes.length;
      this.switchTab(modes[nextIndex]);
    }
  }

  private scrollToSelected(): void {
    if (!this.resultsContainerEl) return;
    const selectedEl = this.resultsContainerEl.querySelector('.qmd-search-result-selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  private async openResult(result: HybridSearchResult | SearchResult | VectorSearchResult): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(result.path);
    if (!file) {
      console.error('File not found:', result.path);
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file as any);
    this.close();
  }
}
