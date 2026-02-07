/**
 * Batch Embedding Processor for QMD Search
 * Processes document chunks in batches with progress tracking
 */

import type { Database, IndexedDocument } from '../database/indexer';
import type { DocumentChunk, DocumentChunker } from './chunker';
import type { OllamaEmbedder, EmbeddingResult } from './embedder';

export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  currentBatch: number;
  totalBatches: number;
  percentage: number;
}

export type ProgressCallback = (progress: BatchProgress) => void;

export interface BatchProcessingOptions {
  batchSize?: number;
  continueOnError?: boolean;
  maxRetries?: number;
}

export interface BatchProcessingResult {
  totalChunks: number;
  successfulEmbeddings: number;
  failedEmbeddings: number;
  errors: string[];
  durationMs: number;
}

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_RETRIES = 1;

export class BatchEmbeddingProcessor {
  constructor(
    private db: Database,
    private embedder: OllamaEmbedder,
    private chunker: DocumentChunker
  ) {}

  async processDocuments(
    documents: IndexedDocument[],
    onProgress?: ProgressCallback,
    options?: BatchProcessingOptions
  ): Promise<BatchProcessingResult> {
    const startTime = performance.now();
    const allChunks: DocumentChunk[] = [];

    for (const doc of documents) {
      const chunks = this.chunker.chunkDocument(doc.hash, doc.content);
      allChunks.push(...chunks);
    }

    if (allChunks.length === 0) {
      return {
        totalChunks: 0,
        successfulEmbeddings: 0,
        failedEmbeddings: 0,
        errors: [],
        durationMs: performance.now() - startTime,
      };
    }

    const result = await this.processChunks(allChunks, onProgress, options);
    return result;
  }

  async processChunks(
    chunks: DocumentChunk[],
    onProgress?: ProgressCallback,
    options?: BatchProcessingOptions
  ): Promise<BatchProcessingResult> {
    const startTime = performance.now();
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    const continueOnError = options?.continueOnError ?? true;
    const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

    const totalBatches = Math.ceil(chunks.length / batchSize);
    let completed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, chunks.length);
      const batchChunks = chunks.slice(batchStart, batchEnd);

      if (onProgress) {
        onProgress({
          total: chunks.length,
          completed,
          failed,
          currentBatch: batchIndex + 1,
          totalBatches,
          percentage: Math.round((completed / chunks.length) * 100),
        });
      }

      try {
        const results = await this.processBatchWithRetry(
          batchChunks,
          maxRetries
        );

        this.db.run('BEGIN TRANSACTION');
        try {
          for (const result of results) {
            if (result.success && result.embedding && result.chunk) {
              this.insertEmbedding(result.embedding, result.chunk);
              completed++;
            } else {
              failed++;
              if (result.error) {
                errors.push(result.error);
              }
            }
          }
          this.db.run('COMMIT');
        } catch (dbError) {
          this.db.run('ROLLBACK');
          throw dbError;
        }
      } catch (error) {
        const errorMsg = `Batch ${batchIndex + 1} failed: ${error}`;
        errors.push(errorMsg);
        console.error(`[QMD] ${errorMsg}`);

        if (!continueOnError) {
          break;
        }

        failed += batchChunks.length;
      }
    }

    if (onProgress) {
      onProgress({
        total: chunks.length,
        completed,
        failed,
        currentBatch: totalBatches,
        totalBatches,
        percentage: 100,
      });
    }

    return {
      totalChunks: chunks.length,
      successfulEmbeddings: completed,
      failedEmbeddings: failed,
      errors,
      durationMs: performance.now() - startTime,
    };
  }

  private async processBatchWithRetry(
    chunks: DocumentChunk[],
    maxRetries: number
  ): Promise<Array<{ success: boolean; embedding?: EmbeddingResult; chunk: DocumentChunk; error?: string }>> {
    const results: Array<{ success: boolean; embedding?: EmbeddingResult; chunk: DocumentChunk; error?: string }> = [];

    for (const chunk of chunks) {
      let lastError: string | undefined;
      let success = false;
      let embedding: EmbeddingResult | undefined;

      for (let attempt = 0; attempt <= maxRetries && !success; attempt++) {
        try {
          embedding = await this.embedder.embedChunk(chunk);
          success = true;
        } catch (error) {
          lastError = `${chunk.hash}_${chunk.seq}: ${error}`;
          if (attempt < maxRetries) {
            await this.delay(100 * (attempt + 1));
          }
        }
      }

      results.push({ success, embedding, chunk, error: lastError });
    }

    return results;
  }

  private insertEmbedding(result: EmbeddingResult, chunk: DocumentChunk): void {
    const hashSeq = result.hashSeq;
    const [hash, seqStr] = hashSeq.split('_');
    const seq = parseInt(seqStr, 10);
    const now = Date.now();

    // Store chunk text in content_vectors table
    this.db.run(
      `INSERT INTO content_vectors (hash_seq, hash, seq, chunk_text, token_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(hash_seq) DO UPDATE SET
         chunk_text = excluded.chunk_text,
         token_count = excluded.token_count`,
      [hashSeq, hash, seq, chunk.text, chunk.tokenCount, now]
    );

    // Store embedding vector in vectors_vec (vec0) table
    const embeddingArray = Array.from(result.embedding);
    this.db.run(
      `INSERT INTO vectors_vec (hash_seq, embedding)
       VALUES (?, ?)
       ON CONFLICT(hash_seq) DO UPDATE SET embedding = excluded.embedding`,
      [hashSeq, JSON.stringify(embeddingArray)]
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async checkOllamaAvailability(): Promise<{
    available: boolean;
    model: string | null;
    error?: string;
  }> {
    const status = await this.embedder.testConnection();

    if (!status.connected) {
      return {
        available: false,
        model: null,
        error: `Ollama not running. Start with: ollama serve`,
      };
    }

    if (!status.modelAvailable) {
      return {
        available: false,
        model: null,
        error: status.error ?? this.embedder.getInstallInstructions(),
      };
    }

    return {
      available: true,
      model: status.activeModel,
    };
  }

  async processDocumentsWithGracefulDegradation(
    documents: IndexedDocument[],
    onProgress?: ProgressCallback,
    options?: BatchProcessingOptions
  ): Promise<BatchProcessingResult & { ollamaAvailable: boolean }> {
    const availability = await this.checkOllamaAvailability();

    if (!availability.available) {
      console.warn(`[QMD] Ollama unavailable: ${availability.error}`);
      return {
        totalChunks: 0,
        successfulEmbeddings: 0,
        failedEmbeddings: 0,
        errors: [availability.error ?? 'Ollama not available'],
        durationMs: 0,
        ollamaAvailable: false,
      };
    }

    const result = await this.processDocuments(documents, onProgress, options);
    return {
      ...result,
      ollamaAvailable: true,
    };
  }

  getPerformanceEstimate(chunkCount: number): {
    estimatedSeconds: number;
    chunksPerSecond: number;
  } {
    const avgMsPerChunk = 150;
    const estimatedMs = chunkCount * avgMsPerChunk;

    return {
      estimatedSeconds: Math.ceil(estimatedMs / 1000),
      chunksPerSecond: Math.round(1000 / avgMsPerChunk),
    };
  }
}

export { DEFAULT_BATCH_SIZE };
