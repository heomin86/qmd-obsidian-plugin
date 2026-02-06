import { Notice } from 'obsidian';
import type { DocumentIndexer, IndexingProgress } from '../database/indexer';
import { ProgressModal } from '../ui/progress-modal';
import type { App } from 'obsidian';

export function registerIndexCommands(
  app: App,
  indexer: DocumentIndexer,
  addCommand: (config: any) => void
): void {
  
  addCommand({
    id: 'reindex-all',
    name: 'Reindex all documents',
    callback: async () => {
      const progressModal = new ProgressModal(app, 'Reindexing all documents...', true);
      progressModal.open();

      let cancelled = false;
      progressModal.onCancelCallback(() => {
        cancelled = true;
      });

      const onProgress = (progress: IndexingProgress) => {
        if (cancelled) return;
        progressModal.setProgress(
          progress.current,
          progress.total,
          `Indexing ${progress.currentFile} (${progress.current}/${progress.total})`
        );
      };

      try {
        const count = await indexer.reindexAll(onProgress);
        if (!cancelled) {
          progressModal.complete(`Indexed ${count} documents!`);
          new Notice(`Successfully indexed ${count} documents`);
        }
      } catch (error) {
        progressModal.close();
        const message = error instanceof Error ? error.message : 'Unknown error';
        new Notice(`Indexing failed: ${message}`);
        console.error('Reindex failed:', error);
      }
    }
  });

  addCommand({
    id: 'reindex-collection',
    name: 'Reindex collection',
    callback: async () => {
      new Notice('Collection selection not yet implemented');
    }
  });
}
