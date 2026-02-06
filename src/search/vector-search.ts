/**
 * Vector Similarity Search using sqlite-vec KNN
 * 
 * Provides semantic search capabilities using vector embeddings stored in 
 * SQLite vec0 virtual tables with cosine distance KNN similarity search.
 * 
 * @module search/vector-search
 */

import { OllamaEmbedder, EmbeddingError, type OllamaConfig } from '../embeddings/embedder';

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
 * Result from a vector similarity search query
 */
export interface VectorSearchResult {
  /** Document hash (unique identifier) */
  hash: string;
  /** Document title */
  title: string;
  /** Full document content */
  content: string;
  /** File path relative to vault */
  path: string;
  /** Cosine similarity score (0-100, higher = more similar) */
  similarity: number;
  /** Raw cosine distance from sqlite-vec (0 = identical, 2 = opposite) */
  distance: number;
  /** Result position (1 = best match) */
  rank: number;
}

/**
 * Options for vector search queries
 */
export interface VectorSearchOptions {
  /** Filter results to a specific collection by name */
  collectionFilter?: string;
  /** Maximum number of results to return (default: 20) */
  limit?: number;
  /** Minimum similarity threshold (0-100, default: no threshold) */
  minSimilarity?: number;
}

/**
 * Error thrown when vector search operations fail
 */
export class VectorSearchError extends Error {
  constructor(
    message: string,
    public readonly code: 
      | 'DB_NOT_INITIALIZED'
      | 'EMBEDDER_NOT_AVAILABLE'
      | 'INVALID_EMBEDDING'
      | 'QUERY_ERROR'
      | 'DIMENSION_MISMATCH'
  ) {
    super(message);
    this.name = 'VectorSearchError';
  }
}

/**
 * Vector Similarity Searcher using sqlite-vec KNN
 * 
 * Provides semantic search capabilities using vector embeddings with
 * KNN (K-Nearest Neighbors) similarity search on cosine distance.
 * 
 * The vectors_vec table uses the vec0 virtual table format:
 * - hash_seq: TEXT PRIMARY KEY (format: "{hash}_{seq}")
 * - embedding: float[768] with distance_metric=cosine
 * 
 * Cosine distance ranges from 0 (identical) to 2 (opposite vectors).
 * We convert this to a similarity percentage for user-friendly display.
 * 
 * @example
 * ```typescript
 * const embedder = new OllamaEmbedder();
 * const searcher = new VectorSearcher(db, embedder);
 * 
 * // Basic semantic search
 * const results = await searcher.search('machine learning concepts');
 * 
 * // Search with options
 * const filtered = await searcher.search('neural networks', {
 *   collectionFilter: 'research-notes',
 *   minSimilarity: 50,
 *   limit: 10
 * });
 * 
 * // Search with pre-computed embedding
 * const embedding = await embedder.generateEmbedding('query text');
 * const results = await searcher.searchWithEmbedding(embedding);
 * ```
 */
export class VectorSearcher {
  private readonly DEFAULT_LIMIT = 20;
  private readonly EXPECTED_DIMENSIONS = 768;
  private initialized = false;

  constructor(
    private db: Database,
    private embedder: OllamaEmbedder
  ) {
    this.validateDatabase();
  }

  /**
   * Validate database is initialized
   */
  private validateDatabase(): void {
    if (!this.db) {
      throw new VectorSearchError(
        'Database not initialized',
        'DB_NOT_INITIALIZED'
      );
    }
    this.initialized = true;
  }

  /**
   * Convert cosine distance to similarity percentage
   * 
   * Cosine distance in sqlite-vec with distance_metric=cosine:
   * - 0 = identical vectors (maximum similarity)
   * - 2 = opposite vectors (minimum similarity)
   * 
   * Formula: similarity = (1 - (distance / 2)) * 100
   * This maps [0, 2] -> [100, 0]
   * 
   * @param distance - Raw cosine distance from sqlite-vec (0 to 2)
   * @returns Similarity percentage (0 to 100)
   */
  private distanceToSimilarity(distance: number): number {
    // Clamp distance to valid range [0, 2]
    const clampedDistance = Math.max(0, Math.min(2, distance));
    // Convert to similarity: 0 distance = 100% similarity, 2 distance = 0% similarity
    return (1 - clampedDistance / 2) * 100;
  }

  /**
   * Convert similarity percentage to cosine distance
   * 
   * Inverse of distanceToSimilarity:
   * distance = 2 * (1 - similarity / 100)
   * 
   * @param similarity - Similarity percentage (0 to 100)
   * @returns Cosine distance (0 to 2)
   */
  private similarityToDistance(similarity: number): number {
    // Clamp similarity to valid range [0, 100]
    const clampedSimilarity = Math.max(0, Math.min(100, similarity));
    // Convert to distance: 100% similarity = 0 distance, 0% similarity = 2 distance
    return 2 * (1 - clampedSimilarity / 100);
  }

  /**
   * Validate embedding dimensions
   * 
   * @param embedding - Embedding to validate
   * @throws VectorSearchError if dimensions don't match expected
   */
  private validateEmbedding(embedding: Float32Array): void {
    if (embedding.length !== this.EXPECTED_DIMENSIONS) {
      throw new VectorSearchError(
        `Invalid embedding dimensions: expected ${this.EXPECTED_DIMENSIONS}, got ${embedding.length}`,
        'DIMENSION_MISMATCH'
      );
    }
  }

  /**
   * Perform semantic search using vector similarity
   * 
   * Generates an embedding for the query text using OllamaEmbedder,
   * then performs KNN search in the vectors_vec table.
   * 
   * @param query - Natural language search query
   * @param options - Search options (collection filter, min similarity, limit)
   * @returns Array of search results ordered by similarity (best first)
   * @throws VectorSearchError if Ollama is unavailable or embedding fails
   */
  async search(query: string, options?: VectorSearchOptions): Promise<VectorSearchResult[]> {
    if (!this.initialized) {
      throw new VectorSearchError('Database not initialized', 'DB_NOT_INITIALIZED');
    }

    if (!query || query.trim().length === 0) {
      return [];
    }

    const isAvailable = await this.embedder.isAvailable();
    if (!isAvailable) {
      throw new VectorSearchError(
        `Ollama embedding service not available. ${this.embedder.getInstallInstructions()}`,
        'EMBEDDER_NOT_AVAILABLE'
      );
    }

    try {
      const embedding = await this.embedder.generateEmbedding(query.trim());
      return this.searchWithEmbedding(embedding, options);
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw new VectorSearchError(
          `Failed to generate query embedding: ${error.message}`,
          'EMBEDDER_NOT_AVAILABLE'
        );
      }
      if (error instanceof VectorSearchError) {
        throw error;
      }
      throw new VectorSearchError(
        `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUERY_ERROR'
      );
    }
  }

  /**
   * Perform semantic search using a pre-computed embedding
   * 
   * Useful when you already have an embedding vector and want to find
   * similar documents without re-generating the embedding.
   * 
   * Uses sqlite-vec KNN query syntax:
   * ```sql
   * WHERE embedding MATCH ? AND k = ?
   * ```
   * 
   * @param embedding - Pre-computed 768-dimensional embedding vector
   * @param options - Search options (collection filter, min similarity, limit)
   * @returns Array of search results ordered by similarity (best first)
   */
  async searchWithEmbedding(
    embedding: Float32Array,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    if (!this.initialized) {
      throw new VectorSearchError('Database not initialized', 'DB_NOT_INITIALIZED');
    }

    this.validateEmbedding(embedding);

    const limit = options?.limit ?? this.DEFAULT_LIMIT;
    const collectionFilter = options?.collectionFilter;
    const minSimilarity = options?.minSimilarity;

    const maxDistance = minSimilarity !== undefined 
      ? this.similarityToDistance(minSimilarity) 
      : undefined;

    try {
      let sql: string;
      const queryLimit = limit;

      if (collectionFilter) {
        sql = `
          SELECT 
            v.hash_seq,
            v.distance,
            cv.hash,
            cv.seq,
            d.title,
            d.content,
            d.path
          FROM vectors_vec v
          JOIN content_vectors cv ON v.hash_seq = (cv.hash || '_' || cv.seq)
          JOIN documents d ON cv.hash = d.hash
          JOIN collections c ON d.collection_id = c.id
          WHERE v.embedding MATCH ?
            AND k = ?
            AND d.active = 1
            AND c.name = ?
          ORDER BY v.distance ASC
        `;
      } else {
        sql = `
          SELECT 
            v.hash_seq,
            v.distance,
            cv.hash,
            cv.seq,
            d.title,
            d.content,
            d.path
          FROM vectors_vec v
          JOIN content_vectors cv ON v.hash_seq = (cv.hash || '_' || cv.seq)
          JOIN documents d ON cv.hash = d.hash
          WHERE v.embedding MATCH ?
            AND k = ?
            AND d.active = 1
          ORDER BY v.distance ASC
        `;
      }

      const stmt = this.db.prepare(sql);
      const results: VectorSearchResult[] = [];

      try {
        const embeddingBuffer = new Uint8Array(embedding.buffer);
        
        if (collectionFilter) {
          stmt.bind([embeddingBuffer, queryLimit, collectionFilter] as SqlValue[]);
        } else {
          stmt.bind([embeddingBuffer, queryLimit] as SqlValue[]);
        }

        let rank = 1;
        while (stmt.step()) {
          const row = stmt.get();
          const hashSeq = row[0] as string;
          const distance = row[1] as number;
          const hash = row[2] as string;
          const title = row[4] as string;
          const content = row[5] as string;
          const path = row[6] as string;

          const similarity = this.distanceToSimilarity(distance);

          if (maxDistance !== undefined && distance > maxDistance) {
            continue;
          }

          results.push({
            hash,
            title,
            content,
            path,
            similarity,
            distance,
            rank: rank++,
          });
        }
      } finally {
        stmt.free();
      }

      return results;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('no such table: vectors_vec')) {
          throw new VectorSearchError(
            'Vector search table not initialized. Run embedding generation first.',
            'DB_NOT_INITIALIZED'
          );
        }
        if (error.message.includes('vec0')) {
          throw new VectorSearchError(
            `Vector search query failed: ${error.message}`,
            'QUERY_ERROR'
          );
        }
      }
      throw new VectorSearchError(
        `Search query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUERY_ERROR'
      );
    }
  }

  /**
   * Check if the vector search index is ready
   * 
   * Verifies that:
   * 1. Database is initialized
   * 2. vectors_vec table exists
   * 3. Embedder is available (optional check)
   * 
   * @param checkEmbedder - Whether to also check Ollama availability (default: false)
   * @returns True if vector search is ready
   */
  async isReady(checkEmbedder = false): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    try {
      this.db.exec('SELECT 1 FROM vectors_vec LIMIT 1');
    } catch {
      return false;
    }

    if (checkEmbedder) {
      return this.embedder.isAvailable();
    }

    return true;
  }

  /**
   * Get count of vectors in the index
   * 
   * @returns Number of indexed vectors
   */
  async getVectorCount(): Promise<number> {
    try {
      const result = this.db.exec('SELECT COUNT(*) FROM vectors_vec');
      if (result[0]?.values[0]?.[0] !== undefined) {
        return result[0].values[0][0] as number;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get diagnostic information about the vector search system
   * 
   * @returns Diagnostic object with status information
   */
  async getDiagnostics(): Promise<{
    databaseReady: boolean;
    vectorTableExists: boolean;
    vectorCount: number;
    embedderAvailable: boolean;
    activeModel: string | null;
    expectedDimensions: number;
  }> {
    let vectorTableExists = false;
    let vectorCount = 0;

    try {
      this.db.exec('SELECT 1 FROM vectors_vec LIMIT 1');
      vectorTableExists = true;
      vectorCount = await this.getVectorCount();
    } catch {
    }

    const embedderStatus = await this.embedder.testConnection();

    return {
      databaseReady: this.initialized,
      vectorTableExists,
      vectorCount,
      embedderAvailable: embedderStatus.modelAvailable,
      activeModel: embedderStatus.activeModel,
      expectedDimensions: this.EXPECTED_DIMENSIONS,
    };
  }
}

export { OllamaEmbedder, EmbeddingError };
export type { OllamaConfig };
