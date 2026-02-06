/**
 * Ollama Embedder for QMD Search
 * Generates 768-dimensional embeddings using Ollama API (nomic-embed-text model)
 */

import type { DocumentChunk } from './chunker';

/**
 * Result of embedding generation for a document chunk
 */
export interface EmbeddingResult {
  /** Combined identifier: `${hash}_${seq}` */
  hashSeq: string;
  /** 768-dimensional embedding vector */
  embedding: Float32Array;
  /** Model used for generation */
  model: string;
}

/**
 * Configuration for Ollama API connection
 */
export interface OllamaConfig {
  /** Base URL for Ollama API (default: http://localhost:11434) */
  baseUrl?: string;
  /** Model for embeddings (default: nomic-embed-text) */
  model?: string;
  /** Fallback model if primary not available (default: mxbai-embed-large) */
  fallbackModel?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Expected embedding dimensions (default: 768) */
  expectedDimensions?: number;
}

/**
 * Ollama API embedding response
 */
interface OllamaEmbeddingResponse {
  embedding: number[];
  model?: string;
}

/**
 * Ollama API tags response (for model availability check)
 */
interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
  }>;
}

/**
 * Error types for embedding operations
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly code: 
      | 'CONNECTION_REFUSED'
      | 'MODEL_NOT_FOUND'
      | 'TIMEOUT'
      | 'INVALID_RESPONSE'
      | 'DIMENSION_MISMATCH'
      | 'API_ERROR'
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<OllamaConfig> = {
  baseUrl: 'http://localhost:11434',
  model: 'nomic-embed-text',
  fallbackModel: 'mxbai-embed-large',
  timeout: 30000,
  expectedDimensions: 768,
};

/**
 * Ollama Embedder class
 * Generates embeddings using Ollama's local API
 */
export class OllamaEmbedder {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fallbackModel: string;
  private readonly timeout: number;
  private readonly expectedDimensions: number;
  
  /** Cached model availability status */
  private modelAvailable: boolean | null = null;
  private actualModel: string;

  constructor(config?: OllamaConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_CONFIG.baseUrl;
    this.model = config?.model ?? DEFAULT_CONFIG.model;
    this.fallbackModel = config?.fallbackModel ?? DEFAULT_CONFIG.fallbackModel;
    this.timeout = config?.timeout ?? DEFAULT_CONFIG.timeout;
    this.expectedDimensions = config?.expectedDimensions ?? DEFAULT_CONFIG.expectedDimensions;
    this.actualModel = this.model;
  }

  /**
   * Fetch with timeout support
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = this.timeout
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new EmbeddingError(
            `Request timed out after ${timeoutMs}ms`,
            'TIMEOUT'
          );
        }
        // Connection refused or network error
        if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
          throw new EmbeddingError(
            `Cannot connect to Ollama at ${this.baseUrl}. Ensure Ollama is running.`,
            'CONNECTION_REFUSED'
          );
        }
      }
      throw error;
    }
  }

  /**
   * Check if Ollama is running and the model is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        5000 // Quick check timeout
      );

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as OllamaTagsResponse;
      const modelNames = data.models?.map(m => m.name.split(':')[0]) ?? [];

      // Check if primary model is available
      if (modelNames.includes(this.model)) {
        this.actualModel = this.model;
        this.modelAvailable = true;
        return true;
      }

      // Check fallback model
      if (modelNames.includes(this.fallbackModel)) {
        console.warn(
          `[QMD] Primary model "${this.model}" not found, using fallback "${this.fallbackModel}"`
        );
        this.actualModel = this.fallbackModel;
        this.modelAvailable = true;
        return true;
      }

      console.warn(
        `[QMD] Neither "${this.model}" nor "${this.fallbackModel}" found. ` +
        `Available models: ${modelNames.join(', ')}`
      );
      this.modelAvailable = false;
      return false;
    } catch {
      this.modelAvailable = false;
      return false;
    }
  }

  /**
   * Get the model currently in use
   */
  getActiveModel(): string {
    return this.actualModel;
  }

  /**
   * Get installation instructions for missing model
   */
  getInstallInstructions(): string {
    return `To install the embedding model, run:\n  ollama pull ${this.model}`;
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    if (!text || text.trim().length === 0) {
      throw new EmbeddingError(
        'Cannot generate embedding for empty text',
        'INVALID_RESPONSE'
      );
    }

    // Check availability if not already checked
    if (this.modelAvailable === null) {
      await this.isAvailable();
    }

    if (this.modelAvailable === false) {
      throw new EmbeddingError(
        `Embedding model not available. ${this.getInstallInstructions()}`,
        'MODEL_NOT_FOUND'
      );
    }

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/embed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.actualModel,
            input: text,
          }),
        }
      );

      if (!response.ok) {
        // Handle model not found specifically
        if (response.status === 404) {
          // Try fallback if we haven't already
          if (this.actualModel !== this.fallbackModel) {
            console.warn(
              `[QMD] Model "${this.actualModel}" not found, trying fallback "${this.fallbackModel}"`
            );
            this.actualModel = this.fallbackModel;
            return this.generateEmbedding(text);
          }
          throw new EmbeddingError(
            `Embedding model not found. ${this.getInstallInstructions()}`,
            'MODEL_NOT_FOUND'
          );
        }

        const errorText = await response.text().catch(() => 'Unknown error');
        throw new EmbeddingError(
          `Ollama API error (${response.status}): ${errorText}`,
          'API_ERROR'
        );
      }

      const data = (await response.json()) as OllamaEmbeddingResponse;

      // Validate response structure
      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new EmbeddingError(
          'Invalid response from Ollama: missing embedding array',
          'INVALID_RESPONSE'
        );
      }

      // Validate dimensions
      if (data.embedding.length !== this.expectedDimensions) {
        console.warn(
          `[QMD] Unexpected embedding dimensions: expected ${this.expectedDimensions}, ` +
          `got ${data.embedding.length}. Proceeding anyway.`
        );
      }

      // Convert to Float32Array for efficient storage
      return new Float32Array(data.embedding);
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error;
      }

      if (error instanceof Error) {
        // Handle fetch/network errors
        if (error.message.includes('Failed to fetch') || 
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('NetworkError')) {
          throw new EmbeddingError(
            `Cannot connect to Ollama at ${this.baseUrl}. Ensure Ollama is running.`,
            'CONNECTION_REFUSED'
          );
        }
      }

      throw new EmbeddingError(
        `Failed to generate embedding: ${error}`,
        'API_ERROR'
      );
    }
  }

  /**
   * Generate embeddings for multiple texts
   * Note: Ollama API processes one at a time, but we handle batching at application level
   */
  async generateBatch(
    texts: string[],
    options?: { skipOnError?: boolean }
  ): Promise<(Float32Array | null)[]> {
    const results: (Float32Array | null)[] = [];
    const skipOnError = options?.skipOnError ?? true;

    for (const text of texts) {
      try {
        const embedding = await this.generateEmbedding(text);
        results.push(embedding);
      } catch (error) {
        if (skipOnError) {
          console.warn(
            `[QMD] Failed to generate embedding for text (${text.substring(0, 50)}...): ${error}`
          );
          results.push(null);
        } else {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Embed a single document chunk
   */
  async embedChunk(chunk: DocumentChunk): Promise<EmbeddingResult> {
    const embedding = await this.generateEmbedding(chunk.text);
    
    return {
      hashSeq: `${chunk.hash}_${chunk.seq}`,
      embedding,
      model: this.actualModel,
    };
  }

  /**
   * Embed multiple document chunks
   */
  async embedChunks(
    chunks: DocumentChunk[],
    options?: { skipOnError?: boolean }
  ): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    const skipOnError = options?.skipOnError ?? true;

    for (const chunk of chunks) {
      try {
        const result = await this.embedChunk(chunk);
        results.push(result);
      } catch (error) {
        if (!skipOnError) {
          throw error;
        }
        console.warn(
          `[QMD] Failed to embed chunk ${chunk.hash}_${chunk.seq}: ${error}`
        );
        // Skip failed chunks
      }
    }

    return results;
  }

  /**
   * Test connection to Ollama
   * Returns detailed status for diagnostics
   */
  async testConnection(): Promise<{
    connected: boolean;
    modelAvailable: boolean;
    activeModel: string | null;
    error?: string;
  }> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        5000
      );

      if (!response.ok) {
        return {
          connected: true,
          modelAvailable: false,
          activeModel: null,
          error: `API returned status ${response.status}`,
        };
      }

      const data = (await response.json()) as OllamaTagsResponse;
      const modelNames = data.models?.map(m => m.name.split(':')[0]) ?? [];

      const primaryAvailable = modelNames.includes(this.model);
      const fallbackAvailable = modelNames.includes(this.fallbackModel);

      if (primaryAvailable) {
        return {
          connected: true,
          modelAvailable: true,
          activeModel: this.model,
        };
      }

      if (fallbackAvailable) {
        return {
          connected: true,
          modelAvailable: true,
          activeModel: this.fallbackModel,
          error: `Primary model "${this.model}" not found, using fallback`,
        };
      }

      return {
        connected: true,
        modelAvailable: false,
        activeModel: null,
        error: `Models not found. Available: ${modelNames.join(', ')}. ${this.getInstallInstructions()}`,
      };
    } catch (error) {
      return {
        connected: false,
        modelAvailable: false,
        activeModel: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export { DEFAULT_CONFIG as EMBEDDING_DEFAULT_CONFIG };
