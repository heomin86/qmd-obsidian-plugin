import { Notice } from 'obsidian';
import type { Database } from '../database';
import type { DocumentIndexer } from '../database/indexer';

export function registerMaintenanceCommands(
  indexer: DocumentIndexer,
  db: Database,
  addCommand: (config: any) => void
): void {

  addCommand({
    id: 'database-vacuum',
    name: 'Optimize database (VACUUM)',
    callback: async () => {
      const notice = new Notice('Optimizing database...', 0);
      try {
        db.run('VACUUM');
        notice.hide();
        new Notice('Database optimized successfully');
      } catch (error) {
        notice.hide();
        const message = error instanceof Error ? error.message : 'Unknown error';
        new Notice(`Optimization failed: ${message}`);
        console.error('VACUUM failed:', error);
      }
    }
  });

  addCommand({
    id: 'show-stats',
    name: 'Show database statistics',
    callback: async () => {
      try {
        const stats = await indexer.getStats();
        const message = `
Database Statistics:
- Total Documents: ${stats.totalDocuments}
- Active Documents: ${stats.activeDocuments}
- Collections: ${stats.collectionsIndexed}
        `.trim();
        new Notice(message, 8000);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        new Notice(`Failed to get stats: ${message}`);
        console.error('Get stats failed:', error);
      }
    }
  });

  addCommand({
    id: 'health-check',
    name: 'Run health check',
    callback: async () => {
      try {
        const stats = await indexer.getStats();
        const issues: string[] = [];

        if (stats.totalDocuments === 0) {
          issues.push('No documents indexed');
        }

        if (stats.activeDocuments < stats.totalDocuments) {
          const inactive = stats.totalDocuments - stats.activeDocuments;
          issues.push(`${inactive} inactive documents`);
        }

        if (issues.length === 0) {
          new Notice('Health check passed: No issues found');
        } else {
          new Notice(`Health check found ${issues.length} issue(s):\n${issues.join('\n')}`, 8000);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        new Notice(`Health check failed: ${message}`);
        console.error('Health check failed:', error);
      }
    }
  });
}
