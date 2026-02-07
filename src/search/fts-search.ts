/**
 * FTS5 Full-Text Search with BM25 Ranking
 * 
 * Provides full-text search capabilities using SQLite FTS5 virtual tables
 * with BM25 relevance scoring and snippet extraction.
 * 
 * @module search/fts-search
 */

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

/**
 * Result from a full-text search query
 */
export interface SearchResult {
  /** Document hash (unique identifier) */
  hash: string;
  /** Document title */
  title: string;
  /** Full document content */
  content: string;
  /** File path relative to vault */
  path: string;
  /** Normalized relevance score (0-100, higher = better) */
  score: number;
  /** Context snippet with highlighted matches */
  snippet: string;
  /** Result position (1 = best match) */
  rank: number;
}

/**
 * Options for search queries
 */
export interface SearchOptions {
  /** Filter results to a specific collection by name */
  collectionFilter?: string;
  /** Minimum score threshold (0-100) */
  minScore?: number;
  /** Maximum number of results to return (default: 20) */
  limit?: number;
}

/**
 * Error thrown when search operations fail
 */
export class SearchError extends Error {
  constructor(
    message: string,
    public readonly code: 'DB_NOT_INITIALIZED' | 'INVALID_QUERY' | 'QUERY_ERROR'
  ) {
    super(message);
    this.name = 'SearchError';
  }
}

/**
 * FTS5 Full-Text Searcher
 * 
 * Provides search capabilities using SQLite FTS5 with BM25 ranking.
 * Supports collection filtering, score thresholds, and snippet extraction.
 * 
 * @example
 * ```typescript
 * const searcher = new FTSSearcher(db);
 * 
 * // Basic search
 * const results = await searcher.search('machine learning');
 * 
 * // Search with options
 * const filtered = await searcher.search('neural networks', {
 *   collectionFilter: 'research-notes',
 *   minScore: 50,
 *   limit: 10
 * });
 * 
 * // Search with snippets
 * const withSnippets = await searcher.searchWithSnippets('deep learning');
 * ```
 */
export class FTSSearcher {
  private readonly DEFAULT_LIMIT = 20;
  private readonly MAX_SNIPPET_TOKENS = 32;
  private initialized = false;

  constructor(private db: Database) {
    this.validateDatabase();
  }

  /**
   * Validate database is initialized
   */
  private validateDatabase(): void {
    if (!this.db) {
      throw new SearchError(
        'Database not initialized',
        'DB_NOT_INITIALIZED'
      );
    }
    this.initialized = true;
  }

  /**
   * Convert BM25 score to user-friendly 0-100 scale
   * 
   * BM25 returns negative scores where lower (more negative) = better match.
   * We convert to positive and normalize to 0-100 scale using:
   * score = (1 / (1 + |bm25_score|)) * 100
   * 
   * @param bm25Score - Raw BM25 score (negative value)
   * @returns Normalized score between 0-100
   */
  private normalizeBM25Score(bm25Score: number): number {
    const absScore = Math.abs(bm25Score);
    return (1 / (1 + absScore)) * 100;
  }

  /**
   * Convert user-friendly score (0-100) back to BM25 scale for filtering
   * Inverse of normalizeBM25Score:
   * |bm25| = (100 / score) - 1
   * 
   * @param normalizedScore - User-friendly score (0-100)
   * @returns Approximate BM25 score magnitude
   */
  private denormalizeToBM25(normalizedScore: number): number {
    if (normalizedScore <= 0) return Infinity;
    if (normalizedScore >= 100) return 0;
    return (100 / normalizedScore) - 1;
  }

  /**
   * Sanitize and prepare FTS5 query
   * 
   * Handles special FTS5 syntax:
   * - "phrase query" - exact phrase match
   * - word* - prefix match
   * - wo?d - single character wildcard
   * - AND, OR, NOT - boolean operators
   * - title:query, content:query - column filters
   * 
   * Escapes special characters that would cause parse errors.
   * 
   * @param query - Raw search query from user
   * @returns Sanitized FTS5 query string
   */
  private sanitizeFTS5Query(query: string): string {
    if (!query || typeof query !== 'string') {
      return '';
    }

    let sanitized = query.trim();
    if (!sanitized) {
      return '';
    }

    const FTS5_EXPLICIT_SYNTAX = /["*?]|(?:^|\s)(AND|OR|NOT)(?:\s|$)|(?:title|content):/i;
    if (FTS5_EXPLICIT_SYNTAX.test(sanitized)) {
      return sanitized;
    }

    const FTS5_SPECIAL_CHARS = /[(){}^:\-]/g;
    sanitized = sanitized
      .replace(/"/g, '""')
      .replace(FTS5_SPECIAL_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return sanitized;
  }

  /**
   * Perform full-text search with BM25 ranking
   * 
   * Searches the documents_fts virtual table and returns ranked results.
   * Does not include snippet extraction (faster for listing results).
   * 
   * @param query - Search query (supports FTS5 syntax)
   * @param options - Search options (collection filter, min score, limit)
   * @returns Array of search results ordered by relevance
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new SearchError('Database not initialized', 'DB_NOT_INITIALIZED');
    }

    const sanitizedQuery = this.sanitizeFTS5Query(query);
    if (!sanitizedQuery) {
      return [];
    }

    const limit = options?.limit ?? this.DEFAULT_LIMIT;
    const collectionFilter = options?.collectionFilter;
    const minScore = options?.minScore;

    const bm25Threshold = minScore !== undefined 
      ? this.denormalizeToBM25(minScore) 
      : undefined;

    try {
      let sql: string;
      const params: (string | number)[] = [];

      if (collectionFilter) {
        sql = `
          SELECT 
            d.hash,
            d.title,
            d.content,
            d.path,
            bm25(documents_fts) AS bm25_score
          FROM documents_fts
          JOIN documents d ON documents_fts.hash = d.hash
          JOIN collections c ON d.collection_id = c.id
          WHERE documents_fts MATCH ?
            AND d.active = 1
            AND c.name = ?
            ${bm25Threshold !== undefined ? 'AND abs(bm25(documents_fts)) <= ?' : ''}
          ORDER BY bm25_score ASC
          LIMIT ?
        `;
        params.push(sanitizedQuery, collectionFilter);
        if (bm25Threshold !== undefined) {
          params.push(bm25Threshold);
        }
        params.push(limit);
      } else {
        sql = `
          SELECT 
            d.hash,
            d.title,
            d.content,
            d.path,
            bm25(documents_fts) AS bm25_score
          FROM documents_fts
          JOIN documents d ON documents_fts.hash = d.hash
          WHERE documents_fts MATCH ?
            AND d.active = 1
            ${bm25Threshold !== undefined ? 'AND abs(bm25(documents_fts)) <= ?' : ''}
          ORDER BY bm25_score ASC
          LIMIT ?
        `;
        params.push(sanitizedQuery);
        if (bm25Threshold !== undefined) {
          params.push(bm25Threshold);
        }
        params.push(limit);
      }

      const stmt = this.db.prepare(sql);
      const results: SearchResult[] = [];

      try {
        stmt.bind(params as SqlValue[]);

        let rank = 1;
        while (stmt.step()) {
          const row = stmt.get();
          const bm25Score = row[4] as number;

          results.push({
            hash: row[0] as string,
            title: row[1] as string,
            content: row[2] as string,
            path: row[3] as string,
            score: this.normalizeBM25Score(bm25Score),
            snippet: '',
            rank: rank++,
          });
        }
      } finally {
        stmt.free();
      }

      return results;
    } catch (error) {
      if (error instanceof Error && error.message.includes('fts5')) {
        return [];
      }
      throw new SearchError(
        `Search query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUERY_ERROR'
      );
    }
  }

  /**
   * Perform full-text search with BM25 ranking and snippet extraction
   * 
   * Like search(), but includes context snippets around matching terms.
   * Snippets are highlighted with <mark> tags.
   * 
   * @param query - Search query (supports FTS5 syntax)
   * @param options - Search options (collection filter, min score, limit)
   * @returns Array of search results with snippets, ordered by relevance
   */
  async searchWithSnippets(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new SearchError('Database not initialized', 'DB_NOT_INITIALIZED');
    }

    const sanitizedQuery = this.sanitizeFTS5Query(query);
    if (!sanitizedQuery) {
      return [];
    }

    const limit = options?.limit ?? this.DEFAULT_LIMIT;
    const collectionFilter = options?.collectionFilter;
    const minScore = options?.minScore;

    const bm25Threshold = minScore !== undefined 
      ? this.denormalizeToBM25(minScore) 
      : undefined;

    try {
      let sql: string;
      const params: (string | number)[] = [];

      if (collectionFilter) {
        sql = `
          SELECT 
            d.hash,
            d.title,
            d.content,
            d.path,
            bm25(documents_fts) AS bm25_score,
            snippet(documents_fts, 2, '<mark>', '</mark>', '...', ${this.MAX_SNIPPET_TOKENS}) AS snippet
          FROM documents_fts
          JOIN documents d ON documents_fts.hash = d.hash
          JOIN collections c ON d.collection_id = c.id
          WHERE documents_fts MATCH ?
            AND d.active = 1
            AND c.name = ?
            ${bm25Threshold !== undefined ? 'AND abs(bm25(documents_fts)) <= ?' : ''}
          ORDER BY bm25_score ASC
          LIMIT ?
        `;
        params.push(sanitizedQuery, collectionFilter);
        if (bm25Threshold !== undefined) {
          params.push(bm25Threshold);
        }
        params.push(limit);
      } else {
        sql = `
          SELECT 
            d.hash,
            d.title,
            d.content,
            d.path,
            bm25(documents_fts) AS bm25_score,
            snippet(documents_fts, 2, '<mark>', '</mark>', '...', ${this.MAX_SNIPPET_TOKENS}) AS snippet
          FROM documents_fts
          JOIN documents d ON documents_fts.hash = d.hash
          WHERE documents_fts MATCH ?
            AND d.active = 1
            ${bm25Threshold !== undefined ? 'AND abs(bm25(documents_fts)) <= ?' : ''}
          ORDER BY bm25_score ASC
          LIMIT ?
        `;
        params.push(sanitizedQuery);
        if (bm25Threshold !== undefined) {
          params.push(bm25Threshold);
        }
        params.push(limit);
      }

      const stmt = this.db.prepare(sql);
      const results: SearchResult[] = [];

      try {
        stmt.bind(params as SqlValue[]);

        let rank = 1;
        while (stmt.step()) {
          const row = stmt.get();
          const bm25Score = row[4] as number;

          results.push({
            hash: row[0] as string,
            title: row[1] as string,
            content: row[2] as string,
            path: row[3] as string,
            score: this.normalizeBM25Score(bm25Score),
            snippet: (row[5] as string) || '',
            rank: rank++,
          });
        }
      } finally {
        stmt.free();
      }

      return results;
    } catch (error) {
      if (error instanceof Error && error.message.includes('fts5')) {
        return [];
      }
      throw new SearchError(
        `Search query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUERY_ERROR'
      );
    }
  }

  /**
   * Search only in document titles
   * 
   * Uses FTS5 column filter syntax to search only the title field.
   * Useful for finding documents by name.
   * 
   * @param query - Search query
   * @param options - Search options
   * @returns Array of search results
   */
  async searchTitles(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const titleQuery = `title:${this.sanitizeFTS5Query(query)}`;
    return this.searchWithSnippets(titleQuery, options);
  }

  /**
   * Search only in document content (not titles)
   * 
   * Uses FTS5 column filter syntax to search only the content field.
   * Useful when looking for specific content, not document names.
   * 
   * @param query - Search query
   * @param options - Search options
   * @returns Array of search results
   */
  async searchContent(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const contentQuery = `content:${this.sanitizeFTS5Query(query)}`;
    return this.searchWithSnippets(contentQuery, options);
  }

  /**
   * Get total count of documents in the FTS index
   * 
   * @returns Number of indexed documents
   */
  async getIndexedDocumentCount(): Promise<number> {
    try {
      const result = this.db.exec('SELECT COUNT(*) FROM documents_fts');
      if (result[0]?.values[0]?.[0] !== undefined) {
        return result[0].values[0][0] as number;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if the FTS index exists and is ready
   * 
   * @returns True if index is ready for queries
   */
  async isIndexReady(): Promise<boolean> {
    try {
      this.db.exec("SELECT 1 FROM documents_fts LIMIT 1");
      return true;
    } catch {
      return false;
    }
  }
}
