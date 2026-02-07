/**
 * Document Indexer for QMD Search
 * Indexes markdown files from collections into SQLite with FTS5 support
 */

import type { TFile, Vault } from 'obsidian';
import type { Collection, CollectionManager } from '../collections/manager';

// Re-export Database interface for consistency
type SqlValue = number | string | Uint8Array | null;

interface QueryExecResult {
  columns: string[];
  values: SqlValue[][];
}

interface Statement {
  bind(params?: SqlValue[] | Record<string, SqlValue> | null): boolean;
  step(): boolean;
  get(): SqlValue[];
  free(): boolean;
}

export interface Database {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): QueryExecResult[];
  prepare(sql: string): Statement;
}

export interface IndexedDocument {
  hash: string;
  collectionId: number;
  path: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface IndexingResult {
  indexed: number;
  skipped: number;
  errors: string[];
}

export interface IndexingProgress {
  current: number;
  total: number;
  currentFile: string;
}

export type ProgressCallback = (progress: IndexingProgress) => void;

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
const BATCH_SIZE = 50; // Documents per batch for transactions

/**
 * Generate 6-character hash from content using SHA-256
 * Returns base36 representation for compact storage
 */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  
  // Convert to hex then take first 6 chars
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 6);
}

/**
 * Extract title from markdown content
 * Tries to find first # heading, falls back to filename
 */
function extractTitle(content: string, filename: string): string {
  // Try to find first heading (# Title)
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and frontmatter
    if (!trimmed) continue;
    if (trimmed === '---') {
      // Skip frontmatter block
      const fmEnd = lines.indexOf('---', lines.indexOf(trimmed) + 1);
      if (fmEnd > 0) continue;
    }
    
    // Check for heading
    const headingMatch = trimmed.match(/^#+\s+(.+)$/);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
    
    // Only check first non-empty, non-frontmatter line for heading
    break;
  }
  
  // Fallback: use filename without .md extension
  return filename.replace(/\.md$/i, '').trim();
}

/**
 * Check if file is likely binary (not markdown)
 */
function isBinaryContent(content: string): boolean {
  // Check for null bytes or high ratio of non-printable characters
  const nonPrintable = content.split('').filter(
    char => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0))
  ).length;
  
  return nonPrintable / content.length > 0.1;
}

export class IndexerError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'DUPLICATE' | 'READ_ERROR' | 'DB_ERROR' | 'INVALID_FILE'
  ) {
    super(message);
    this.name = 'IndexerError';
  }
}

export class DocumentIndexer {
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly DEBOUNCE_MS = 500;

  constructor(
    private db: Database,
    private vault: Vault,
    private collectionManager: CollectionManager
  ) {}

  /**
   * Index a single file into the database
   */
  async indexFile(file: TFile, collectionId: number): Promise<IndexedDocument> {
    let content: string;
    
    try {
      content = await this.vault.read(file);
    } catch (error) {
      throw new IndexerError(
        `Failed to read file: ${file.path}`,
        'READ_ERROR'
      );
    }

    // Check for binary content
    if (isBinaryContent(content)) {
      throw new IndexerError(
        `File appears to be binary: ${file.path}`,
        'INVALID_FILE'
      );
    }

    // Warn for large files (but still index them)
    if (content.length > LARGE_FILE_THRESHOLD) {
      console.warn(`[QMD] Large file detected (${(content.length / 1024 / 1024).toFixed(2)}MB): ${file.path}`);
    }

    const title = extractTitle(content, file.name);
    const hash = await hashContent(content);
    const now = Date.now();

    try {
      // Insert or update document
      // FTS5 triggers will handle the documents_fts table automatically
      this.db.run(
        `INSERT INTO documents (hash, collection_id, path, title, content, active, created_at, updated_at, indexed_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           hash = excluded.hash,
           collection_id = excluded.collection_id,
           title = excluded.title,
           content = excluded.content,
           active = 1,
           updated_at = excluded.updated_at,
           indexed_at = excluded.indexed_at`,
        [hash, collectionId, file.path, title, content, now, now, now]
      );
    } catch (error) {
      throw new IndexerError(
        `Database error indexing ${file.path}: ${error}`,
        'DB_ERROR'
      );
    }

    return {
      hash,
      collectionId,
      path: file.path,
      title,
      content,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Index all files in a collection
   */
  async indexCollection(
    collectionName: string,
    progressCallback?: ProgressCallback
  ): Promise<IndexingResult> {
    const collection = await this.collectionManager.getCollection(collectionName);
    if (!collection) {
      throw new IndexerError(
        `Collection "${collectionName}" not found.`,
        'NOT_FOUND'
      );
    }

    const files = await this.collectionManager.listFilesInCollection(collectionName);
    const result: IndexingResult = {
      indexed: 0,
      skipped: 0,
      errors: [],
    };

    // Process in batches for transaction efficiency
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      
      // Start transaction for batch
      this.db.run('BEGIN TRANSACTION');
      
      try {
        for (const file of batch) {
          try {
            // Report progress
            if (progressCallback) {
              progressCallback({
                current: i + batch.indexOf(file) + 1,
                total: files.length,
                currentFile: file.path,
              });
            }

            await this.indexFile(file, collection.id);
            result.indexed++;
          } catch (error) {
            if (error instanceof IndexerError && error.code === 'INVALID_FILE') {
              result.skipped++;
            } else {
              result.errors.push(`${file.path}: ${error}`);
            }
          }
        }
        
        this.db.run('COMMIT');
      } catch (error) {
        this.db.run('ROLLBACK');
        throw error;
      }
    }

    return result;
  }

  /**
   * Update an existing document (file changed)
   */
  async updateDocument(file: TFile): Promise<void> {
    // Find which collection this file belongs to
    const collections = await this.collectionManager.listCollections();
    let targetCollection: Collection | null = null;

    for (const collection of collections) {
      const files = await this.collectionManager.listFilesInCollection(collection.name);
      if (files.some(f => f.path === file.path)) {
        targetCollection = collection;
        break;
      }
    }

    if (!targetCollection) {
      // File not in any collection, skip
      return;
    }

    // Re-index the file (indexFile handles upsert via hash conflict)
    await this.indexFile(file, targetCollection.id);
  }

  /**
   * Mark document as inactive (soft delete)
   * FTS5 delete trigger will fire automatically
   */
  async removeDocument(path: string): Promise<void> {
    this.db.run(
      'UPDATE documents SET active = 0, updated_at = ? WHERE path = ?',
      [Date.now(), path]
    );
  }

  /**
   * Handle file rename - update path in database
   */
  async renameDocument(oldPath: string, newPath: string): Promise<void> {
    const now = Date.now();
    this.db.run(
      'UPDATE documents SET path = ?, updated_at = ? WHERE path = ?',
      [newPath, now, oldPath]
    );
  }

  /**
   * Re-index all documents across all collections
   */
  async reindexAll(progressCallback?: ProgressCallback): Promise<number> {
    const collections = await this.collectionManager.listCollections();
    let totalIndexed = 0;
    let processedFiles = 0;
    let totalFiles = 0;

    // Calculate total files for progress
    for (const collection of collections) {
      const files = await this.collectionManager.listFilesInCollection(collection.name);
      totalFiles += files.length;
    }

    // Mark all documents as inactive before re-indexing
    this.db.run('UPDATE documents SET active = 0');

    for (const collection of collections) {
      const result = await this.indexCollection(
        collection.name,
        progressCallback ? (progress) => {
          progressCallback({
            current: processedFiles + progress.current,
            total: totalFiles,
            currentFile: progress.currentFile,
          });
        } : undefined
      );
      
      const files = await this.collectionManager.listFilesInCollection(collection.name);
      processedFiles += files.length;
      totalIndexed += result.indexed;
    }

    return totalIndexed;
  }

  /**
   * Get document by its file path
   */
  async getDocumentByPath(path: string): Promise<IndexedDocument | null> {
    const stmt = this.db.prepare(
      `SELECT hash, collection_id, path, title, content, created_at, updated_at 
       FROM documents 
       WHERE path = ? AND active = 1`
    );
    
    try {
      stmt.bind([path]);
      
      if (!stmt.step()) {
        return null;
      }
      
      const row = stmt.get() as [string, number, string, string, string, number, number];
      
      return {
        hash: row[0],
        collectionId: row[1],
        path: row[2],
        title: row[3],
        content: row[4],
        createdAt: row[5],
        updatedAt: row[6],
      };
    } finally {
      stmt.free();
    }
  }

  /**
   * Get document by its hash
   */
  async getDocumentByHash(hash: string): Promise<IndexedDocument | null> {
    const stmt = this.db.prepare(
      `SELECT hash, collection_id, path, title, content, created_at, updated_at 
       FROM documents 
       WHERE hash = ? AND active = 1`
    );
    
    try {
      stmt.bind([hash]);
      
      if (!stmt.step()) {
        return null;
      }
      
      const row = stmt.get() as [string, number, string, string, string, number, number];
      
      return {
        hash: row[0],
        collectionId: row[1],
        path: row[2],
        title: row[3],
        content: row[4],
        createdAt: row[5],
        updatedAt: row[6],
      };
    } finally {
      stmt.free();
    }
  }

  /**
   * Get all documents in a collection
   */
  async getDocumentsByCollection(collectionId: number): Promise<IndexedDocument[]> {
    const stmt = this.db.prepare(
      `SELECT hash, collection_id, path, title, content, created_at, updated_at 
       FROM documents 
       WHERE collection_id = ? AND active = 1
       ORDER BY path`
    );

    const results: IndexedDocument[] = [];
    try {
      stmt.bind([collectionId]);
      while (stmt.step()) {
        const row = stmt.get() as [string, number, string, string, string, number, number];
        results.push({
          hash: row[0],
          collectionId: row[1],
          path: row[2],
          title: row[3],
          content: row[4],
          createdAt: row[5],
          updatedAt: row[6],
        });
      }
    } finally {
      stmt.free();
    }

    return results;
  }

  /**
   * Search documents using FTS5
   */
  async searchDocuments(query: string, limit = 50): Promise<IndexedDocument[]> {
    // Escape FTS5 special characters
    const escapedQuery = query
      .replace(/"/g, '""')
      .replace(/'/g, "''");
    
    const result = this.db.exec(
      `SELECT d.hash, d.collection_id, d.path, d.title, d.content, d.created_at, d.updated_at
       FROM documents d
       JOIN documents_fts fts ON d.rowid = fts.rowid
       WHERE documents_fts MATCH '"${escapedQuery}"' AND d.active = 1
       ORDER BY rank
       LIMIT ${limit}`
    );

    if (!result[0]) {
      return [];
    }

    return result[0].values.map((row: SqlValue[]) => ({
      hash: row[0] as string,
      collectionId: row[1] as number,
      path: row[2] as string,
      title: row[3] as string,
      content: row[4] as string,
      createdAt: row[5] as number,
      updatedAt: row[6] as number,
    }));
  }

  /**
   * Get indexing statistics
   */
  async getStats(): Promise<{
    totalDocuments: number;
    activeDocuments: number;
    collectionsIndexed: number;
  }> {
    const totalResult = this.db.exec('SELECT COUNT(*) FROM documents');
    const activeResult = this.db.exec('SELECT COUNT(*) FROM documents WHERE active = 1');
    const collectionsResult = this.db.exec('SELECT COUNT(DISTINCT collection_id) FROM documents WHERE active = 1');

    return {
      totalDocuments: (totalResult[0]?.values[0]?.[0] as number) || 0,
      activeDocuments: (activeResult[0]?.values[0]?.[0] as number) || 0,
      collectionsIndexed: (collectionsResult[0]?.values[0]?.[0] as number) || 0,
    };
  }

  /**
   * Handle file events with debouncing
   */
  handleFileCreate(file: TFile): void {
    this.debounceUpdate(file.path, async () => {
      try {
        await this.updateDocument(file);
      } catch (error) {
        console.error(`[QMD] Error indexing new file ${file.path}:`, error);
      }
    });
  }

  handleFileModify(file: TFile): void {
    this.debounceUpdate(file.path, async () => {
      try {
        await this.updateDocument(file);
      } catch (error) {
        console.error(`[QMD] Error updating file ${file.path}:`, error);
      }
    });
  }

  handleFileDelete(path: string): void {
    this.debounceUpdate(path, async () => {
      try {
        await this.removeDocument(path);
      } catch (error) {
        console.error(`[QMD] Error removing file ${path}:`, error);
      }
    });
  }

  handleFileRename(oldPath: string, newPath: string): void {
    // Cancel any pending operations on old path
    const timer = this.debounceTimers.get(oldPath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(oldPath);
    }

    this.debounceUpdate(newPath, async () => {
      try {
        await this.renameDocument(oldPath, newPath);
      } catch (error) {
        console.error(`[QMD] Error renaming file ${oldPath} -> ${newPath}:`, error);
      }
    });
  }

  /**
   * Debounce rapid file changes
   */
  private debounceUpdate(path: string, callback: () => Promise<void>): void {
    // Clear existing timer for this path
    const existingTimer = this.debounceTimers.get(path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(path);
      await callback();
    }, this.DEBOUNCE_MS);

    this.debounceTimers.set(path, timer);
  }

  /**
   * Clear all pending debounce timers (for cleanup)
   */
  clearPendingUpdates(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}

// Export hash function for external use (e.g., testing)
export { hashContent, extractTitle };
