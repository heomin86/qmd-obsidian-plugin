/**
 * Hybrid Search using Reciprocal Rank Fusion (RRF)
 * 
 * Combines BM25 full-text search and vector semantic search using RRF algorithm
 * to produce unified rankings that leverage both lexical and semantic relevance.
 * 
 * RRF Formula: score = Σ(1 / (k + rank))
 * where k is a constant (typically 60) that controls score distribution.
 * 
 * @module search/hybrid-search
 */

import { FTSSearcher, type SearchResult, type SearchOptions } from './fts-search';
import { VectorSearcher, type VectorSearchResult, type VectorSearchOptions } from './vector-search';
import type { Database } from './fts-search';
import type { OllamaEmbedder } from '../embeddings/embedder';

/**
 * Unified result from hybrid search combining BM25 and vector search
 */
export interface HybridSearchResult {
  /** Document hash (unique identifier) */
  hash: string;
  /** Document title */
  title: string;
  /** Full document content */
  content: string;
  /** File path relative to vault */
  path: string;
  /** Combined RRF score (higher = better) */
  rrfScore: number;
  /** Normalized RRF score (0-100 scale for display) */
  normalizedScore: number;
  /** Original BM25 score if document appeared in FTS results */
  bm25Score?: number;
  /** Original vector similarity if document appeared in vector results */
  similarity?: number;
  /** Rank in BM25 results (1-based, undefined if not in BM25 results) */
  bm25Rank?: number;
  /** Rank in vector results (1-based, undefined if not in vector results) */
  vectorRank?: number;
  /** Final rank after fusion (1 = best match) */
  rank: number;
  /** Context snippet with highlighted matches (from FTS if available) */
  snippet: string;
}

/**
 * Options for hybrid search queries
 */
export interface HybridSearchOptions {
  /** Filter results to a specific collection by name */
  collectionFilter?: string;
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum RRF score threshold (default: no threshold) */
  minScore?: number;
  /** RRF constant k (default: 60) - controls score distribution */
  rrfK?: number;
  /** Number of candidates to fetch from each searcher before fusion (default: 20) */
  candidateLimit?: number;
  /** Enable BM25 search (default: true) */
  enableBM25?: boolean;
  /** Enable vector search (default: true) */
  enableVector?: boolean;
}

/**
 * Strategy for handling unavailable search methods
 */
export type FallbackStrategy = 'fail' | 'graceful';

/**
 * Error thrown when hybrid search operations fail
 */
export class HybridSearchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'SEARCHER_NOT_INITIALIZED'
      | 'ALL_SEARCHES_FAILED'
      | 'INVALID_OPTIONS'
      | 'NO_RESULTS'
  ) {
    super(message);
    this.name = 'HybridSearchError';
  }
}

/**
 * Hybrid Searcher combining BM25 and Vector Search with RRF
 * 
 * Implements Reciprocal Rank Fusion (RRF) to combine rankings from
 * BM25 full-text search and vector semantic search. RRF provides a
 * simple, parameter-light fusion method that works well in practice.
 * 
 * The algorithm:
 * 1. Run BM25 and vector searches in parallel
 * 2. For each document, accumulate: score += 1 / (k + rank)
 * 3. Sort by combined RRF score
 * 4. Normalize scores to 0-100 for display
 * 
 * Documents appearing in both result sets receive higher scores due
 * to contribution from both searches. The k parameter (default 60)
 * controls how quickly scores decrease with rank.
 * 
 * @example
 * ```typescript
 * const embedder = new OllamaEmbedder();
 * const hybridSearcher = new HybridSearcher(db, embedder);
 * 
 * // Basic hybrid search
 * const results = await hybridSearcher.search('machine learning');
 * 
 * // Search with options
 * const customResults = await hybridSearcher.search('neural networks', {
 *   collectionFilter: 'research-notes',
 *   limit: 10,
 *   rrfK: 80,  // Flatter score distribution
 *   candidateLimit: 30  // Fetch more candidates from each searcher
 * });
 * 
 * // BM25-only search (vector unavailable)
 * const bm25Only = await hybridSearcher.search('query', {
 *   enableVector: false
 * });
 * ```
 */
export class HybridSearcher {
  private ftsSearcher: FTSSearcher;
  private vectorSearcher: VectorSearcher;
  private readonly DEFAULT_LIMIT = 10;
  private readonly DEFAULT_CANDIDATE_LIMIT = 20;
  private readonly DEFAULT_RRF_K = 60;

  /**
   * Create a new hybrid searcher
   * 
   * @param db - SQLite database instance
   * @param embedder - Ollama embedder for vector search
   * @param fallbackStrategy - How to handle unavailable search methods (default: 'graceful')
   */
  constructor(
    db: Database,
    embedder: OllamaEmbedder,
    private readonly fallbackStrategy: FallbackStrategy = 'graceful'
  ) {
    this.ftsSearcher = new FTSSearcher(db);
    this.vectorSearcher = new VectorSearcher(db, embedder);
  }

  /**
   * Execute hybrid search combining BM25 and vector results with RRF
   * 
   * Runs both searches in parallel, applies RRF fusion, and returns
   * unified results sorted by combined relevance.
   * 
   * @param query - Search query string
   * @param options - Search options
   * @returns Combined search results with RRF scores
   * @throws {HybridSearchError} If both searches fail or invalid options
   */
  async search(
    query: string,
    options: HybridSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    // Validate and normalize options
    const {
      collectionFilter,
      limit = this.DEFAULT_LIMIT,
      minScore,
      rrfK = this.DEFAULT_RRF_K,
      candidateLimit = this.DEFAULT_CANDIDATE_LIMIT,
      enableBM25 = true,
      enableVector = true
    } = options;

    if (!enableBM25 && !enableVector) {
      throw new HybridSearchError(
        'At least one search method must be enabled',
        'INVALID_OPTIONS'
      );
    }

    if (rrfK <= 0) {
      throw new HybridSearchError(
        'RRF constant k must be positive',
        'INVALID_OPTIONS'
      );
    }

    // Run searches in parallel
    const searchPromises: Promise<SearchResult[] | VectorSearchResult[] | null>[] = [];
    
    if (enableBM25) {
      searchPromises.push(
        this.executeBM25Search(query, {
          collectionFilter,
          limit: candidateLimit
        })
      );
    } else {
      searchPromises.push(Promise.resolve(null));
    }

    if (enableVector) {
      searchPromises.push(
        this.executeVectorSearch(query, {
          collectionFilter,
          limit: candidateLimit
        })
      );
    } else {
      searchPromises.push(Promise.resolve(null));
    }

    const [bm25Results, vectorResults] = await Promise.all(searchPromises);

    // Check if at least one search succeeded
    const hasBM25 = bm25Results && bm25Results.length > 0;
    const hasVector = vectorResults && vectorResults.length > 0;

    if (!hasBM25 && !hasVector) {
      if (this.fallbackStrategy === 'fail') {
        throw new HybridSearchError(
          'Both BM25 and vector searches returned no results',
          'NO_RESULTS'
        );
      }
      return [];
    }

    // Apply RRF fusion
    const hybridResults = this.rrfFusion(
      (bm25Results as SearchResult[] | null) || [],
      (vectorResults as VectorSearchResult[] | null) || [],
      rrfK
    );

    // Apply score threshold if specified
    let filteredResults = hybridResults;
    if (minScore !== undefined) {
      filteredResults = hybridResults.filter(r => r.normalizedScore >= minScore);
    }

    // Apply final limit
    return filteredResults.slice(0, limit);
  }

  /**
   * Execute BM25 search with graceful error handling
   */
  private async executeBM25Search(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[] | null> {
    try {
      return await this.ftsSearcher.search(query, options);
    } catch (error) {
      if (this.fallbackStrategy === 'fail') {
        throw error;
      }
      console.warn('BM25 search failed, falling back to vector only:', error);
      return null;
    }
  }

  /**
   * Execute vector search with graceful error handling
   */
  private async executeVectorSearch(
    query: string,
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[] | null> {
    try {
      return await this.vectorSearcher.search(query, options);
    } catch (error) {
      if (this.fallbackStrategy === 'fail') {
        throw error;
      }
      console.warn('Vector search failed, falling back to BM25 only:', error);
      return null;
    }
  }

  /**
   * Apply Reciprocal Rank Fusion (RRF) to combine result sets
   * 
   * RRF Formula: score(d) = Σ(1 / (k + rank_i))
   * 
   * For each document:
   * - If it appears in BM25 results at rank r1: add 1/(k+r1)
   * - If it appears in vector results at rank r2: add 1/(k+r2)
   * - Documents in both sets get contributions from both
   * 
   * Scores are then normalized to 0-100 scale for display.
   * 
   * @param bm25Results - Results from BM25 search
   * @param vectorResults - Results from vector search
   * @param k - RRF constant (default: 60)
   * @returns Fused and ranked results
   */
  private rrfFusion(
    bm25Results: SearchResult[],
    vectorResults: VectorSearchResult[],
    k: number
  ): HybridSearchResult[] {
    // Map to accumulate scores and metadata
    const scoreMap = new Map<string, {
      hash: string;
      title: string;
      content: string;
      path: string;
      rrfScore: number;
      bm25Score?: number;
      similarity?: number;
      bm25Rank?: number;
      vectorRank?: number;
      snippet: string;
    }>();

    // Process BM25 results
    bm25Results.forEach((result, index) => {
      const rank = index + 1; // 1-based rank
      const rrfContribution = 1 / (k + rank);

      scoreMap.set(result.hash, {
        hash: result.hash,
        title: result.title,
        content: result.content,
        path: result.path,
        rrfScore: rrfContribution,
        bm25Score: result.score,
        bm25Rank: rank,
        snippet: result.snippet || this.createSnippet(result.content)
      });
    });

    // Process vector results
    vectorResults.forEach((result, index) => {
      const rank = index + 1; // 1-based rank
      const rrfContribution = 1 / (k + rank);

      const existing = scoreMap.get(result.hash);
      if (existing) {
        // Document in both result sets - accumulate scores
        existing.rrfScore += rrfContribution;
        existing.similarity = result.similarity;
        existing.vectorRank = rank;
      } else {
        // Document only in vector results
        scoreMap.set(result.hash, {
          hash: result.hash,
          title: result.title,
          content: result.content,
          path: result.path,
          rrfScore: rrfContribution,
          similarity: result.similarity,
          vectorRank: rank,
          snippet: this.createSnippet(result.content)
        });
      }
    });

    // Convert to array and sort by RRF score
    const fusedResults = Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore);

    // Normalize scores to 0-100 scale
    const maxScore = fusedResults[0]?.rrfScore || 1;
    const minScore = fusedResults[fusedResults.length - 1]?.rrfScore || 0;
    const scoreRange = maxScore - minScore || 1;

    // Map to final result format with normalized scores and ranks
    return fusedResults.map((result, index) => ({
      ...result,
      normalizedScore: ((result.rrfScore - minScore) / scoreRange) * 100,
      rank: index + 1
    }));
  }

  /**
   * Create a simple snippet from content when no FTS snippet available
   */
  private createSnippet(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.slice(0, maxLength) + '...';
  }

  /**
   * Get statistics about last search results (for debugging/monitoring)
   */
  getSearchStats(results: HybridSearchResult[]): {
    total: number;
    inBothSets: number;
    bm25Only: number;
    vectorOnly: number;
    avgRRFScore: number;
    maxRRFScore: number;
    minRRFScore: number;
  } {
    const inBothSets = results.filter(r => r.bm25Rank && r.vectorRank).length;
    const bm25Only = results.filter(r => r.bm25Rank && !r.vectorRank).length;
    const vectorOnly = results.filter(r => !r.bm25Rank && r.vectorRank).length;

    const rrfScores = results.map(r => r.rrfScore);
    const avgRRFScore = rrfScores.reduce((sum, s) => sum + s, 0) / (rrfScores.length || 1);
    const maxRRFScore = Math.max(...rrfScores, 0);
    const minRRFScore = Math.min(...rrfScores, 0);

    return {
      total: results.length,
      inBothSets,
      bm25Only,
      vectorOnly,
      avgRRFScore,
      maxRRFScore,
      minRRFScore
    };
  }
}
