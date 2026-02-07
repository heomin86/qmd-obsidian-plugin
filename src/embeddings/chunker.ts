/**
 * Document Chunker for QMD Embeddings
 * Splits documents into token-sized pieces with configurable overlap
 * for efficient embedding generation and vector search.
 */

/**
 * Represents a single chunk of a document
 */
export interface DocumentChunk {
  /** Document hash identifier */
  hash: string;
  /** Sequence number within document (0-indexed) */
  seq: number;
  /** Character position in original document where chunk starts */
  pos: number;
  /** Chunk text content */
  text: string;
  /** Estimated token count */
  tokenCount: number;
}

/**
 * Configuration options for chunking
 */
export interface ChunkOptions {
  /** Maximum tokens per chunk (default: 800) */
  maxTokens?: number;
  /** Overlap percentage between chunks as decimal (default: 0.15 = 15%) */
  overlapPercent?: number;
}

/**
 * Internal structure for tracking segments during chunking
 */
interface TextSegment {
  text: string;
  tokens: number;
  startPos: number;
}

const ABBREVIATIONS = new Set([
  'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'vs', 'etc', 'Inc', 'Ltd', 'Co',
  'i.e', 'e.g', 'cf', 'viz', 'al', 'et', 'approx', 'dept', 'est', 'min', 'max',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

/**
 * Default chunk options
 */
const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  maxTokens: 800,
  overlapPercent: 0.15,
};

/**
 * Document chunker that splits text into overlapping token-sized pieces
 */
export class DocumentChunker {
  private readonly maxTokens: number;
  private readonly overlapPercent: number;
  private readonly overlapTokens: number;

  constructor(options?: ChunkOptions) {
    this.maxTokens = options?.maxTokens ?? DEFAULT_OPTIONS.maxTokens;
    this.overlapPercent = options?.overlapPercent ?? DEFAULT_OPTIONS.overlapPercent;
    this.overlapTokens = Math.floor(this.maxTokens * this.overlapPercent);
  }

  /**
   * Estimate token count for text using GPT-like tokenization approximation.
   * Formula: tokens ~= words * 1.3 + punctuation adjustment
   * Accuracy target: +/- 10% of actual token count
   */
  estimateTokenCount(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    const wordMatches = text.match(/[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uAC00-\uD7AF]+/g);
    const wordCount = wordMatches ? wordMatches.length : 0;

    const punctuationMatches = text.match(/[^\w\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uAC00-\uD7AF]/g);
    const punctuationCount = punctuationMatches ? punctuationMatches.length : 0;

    const cjkMatches = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\uAC00-\uD7AF]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;

    const englishWordCount = wordCount - (cjkCount > 0 ? Math.min(wordCount, cjkCount / 2) : 0);
    const englishTokens = Math.ceil(englishWordCount * 1.3);

    return englishTokens + cjkCount + Math.ceil(punctuationCount * 0.5);
  }

  /**
   * Split text into sentences while preserving abbreviations
   */
  private splitIntoSentences(text: string): string[] {
    if (!text || text.length === 0) {
      return [];
    }

    const paragraphs = text.split(/\n\s*\n/);
    const sentences: string[] = [];

    for (const para of paragraphs) {
      if (!para.trim()) continue;

      const parts = para.split(/(?<=[.!?])(?:\s+)(?=[A-Z0-9\u4E00-\u9FAF\uAC00-\uD7AF"])/);

      for (let i = 0; i < parts.length; i++) {
        let part = parts[i];

        const words = part.trim().split(/\s+/);
        const lastWord = words[words.length - 1]?.replace(/[.!?]+$/, '');

        if (lastWord && ABBREVIATIONS.has(lastWord) && i < parts.length - 1) {
          parts[i + 1] = part + ' ' + parts[i + 1];
          continue;
        }

        if (part.trim()) {
          sentences.push(part.trim());
        }
      }
    }

    return sentences.length > 0 ? sentences : [text.trim()];
  }

  /**
   * Split text into words for fine-grained chunking (fallback for long sentences)
   */
  private splitIntoWords(text: string): string[] {
    return text.split(/(\s+)/).filter(Boolean);
  }

  /**
   * Build segments from text with position tracking
   */
  private buildSegments(content: string): TextSegment[] {
    const sentences = this.splitIntoSentences(content);
    const segments: TextSegment[] = [];
    let currentPos = 0;

    for (const sentence of sentences) {
      const searchStart = currentPos;
      let actualPos = content.indexOf(sentence.trim(), searchStart);
      if (actualPos === -1) {
        actualPos = currentPos;
      }

      const tokens = this.estimateTokenCount(sentence);

      if (tokens > this.maxTokens) {
        const words = this.splitIntoWords(sentence);
        let wordChunk = '';
        let wordPos = actualPos;
        let chunkStartPos = actualPos;

        for (const word of words) {
          const testChunk = wordChunk + word;
          const testTokens = this.estimateTokenCount(testChunk);

          if (testTokens > this.maxTokens && wordChunk.trim()) {
            segments.push({
              text: wordChunk.trim(),
              tokens: this.estimateTokenCount(wordChunk.trim()),
              startPos: chunkStartPos,
            });
            wordChunk = word;
            chunkStartPos = wordPos;
          } else {
            wordChunk = testChunk;
          }
          wordPos += word.length;
        }

        if (wordChunk.trim()) {
          segments.push({
            text: wordChunk.trim(),
            tokens: this.estimateTokenCount(wordChunk.trim()),
            startPos: chunkStartPos,
          });
        }
      } else {
        segments.push({
          text: sentence,
          tokens,
          startPos: actualPos,
        });
      }

      currentPos = actualPos + sentence.length;
    }

    return segments;
  }

  /**
   * Extract text from end of chunk to create overlap
   */
  private extractOverlapText(text: string, targetTokens: number): { text: string; pos: number } {
    if (targetTokens <= 0) {
      return { text: '', pos: text.length };
    }

    const words = text.split(/\s+/);
    const overlapWords: string[] = [];
    let currentTokens = 0;

    for (let i = words.length - 1; i >= 0; i--) {
      const wordTokens = this.estimateTokenCount(words[i]);
      if (currentTokens + wordTokens > targetTokens) {
        break;
      }
      overlapWords.unshift(words[i]);
      currentTokens += wordTokens;
    }

    const overlapText = overlapWords.join(' ');
    const pos = text.lastIndexOf(overlapText);

    return {
      text: overlapText,
      pos: pos >= 0 ? pos : text.length - overlapText.length,
    };
  }

  /**
   * Chunk a single document into overlapping pieces
   */
  chunkDocument(hash: string, content: string): DocumentChunk[] {
    if (!content || content.trim().length === 0) {
      return [];
    }

    const trimmedContent = content.trim();
    const totalTokens = this.estimateTokenCount(trimmedContent);

    if (totalTokens <= this.maxTokens) {
      return [{
        hash,
        seq: 0,
        pos: 0,
        text: trimmedContent,
        tokenCount: totalTokens,
      }];
    }

    const segments = this.buildSegments(trimmedContent);
    const chunks: DocumentChunk[] = [];

    let currentChunkSegments: TextSegment[] = [];
    let currentTokens = 0;
    let seq = 0;
    let chunkStartPos = 0;
    let overlapText = '';
    let overlapTokens = 0;
    let overlapStartOffset = 0;

    const flushChunk = () => {
      if (currentChunkSegments.length === 0) return;

      const chunkText = currentChunkSegments.map(s => s.text).join(' ');
      const actualTokens = this.estimateTokenCount(chunkText);

      chunks.push({
        hash,
        seq,
        pos: chunkStartPos,
        text: chunkText,
        tokenCount: actualTokens,
      });

      const overlap = this.extractOverlapText(chunkText, this.overlapTokens);
      overlapText = overlap.text;
      overlapTokens = this.estimateTokenCount(overlapText);
      overlapStartOffset = overlap.pos;

      seq++;
    };

    for (const segment of segments) {
      const testTokens = currentTokens + segment.tokens;

      if (testTokens > this.maxTokens) {
        flushChunk();

        currentChunkSegments = [];
        currentTokens = 0;

        if (overlapText) {
          const lastChunk = chunks[chunks.length - 1];
          if (lastChunk) {
            chunkStartPos = lastChunk.pos + overlapStartOffset;
          }

          currentChunkSegments.push({
            text: overlapText,
            tokens: overlapTokens,
            startPos: chunkStartPos,
          });
          currentTokens = overlapTokens;
        } else {
          chunkStartPos = segment.startPos;
        }
      }

      if (currentChunkSegments.length === 0) {
        chunkStartPos = segment.startPos;
      }

      currentChunkSegments.push(segment);
      currentTokens += segment.tokens;
    }

    if (currentChunkSegments.length > 0) {
      const chunkText = currentChunkSegments.map(s => s.text).join(' ');
      const actualTokens = this.estimateTokenCount(chunkText);

      chunks.push({
        hash,
        seq,
        pos: chunkStartPos,
        text: chunkText,
        tokenCount: actualTokens,
      });
    }

    return chunks;
  }

  /**
   * Chunk multiple documents efficiently
   * Returns Map of document hash to its chunks
   */
  chunkDocuments(docs: Array<{ hash: string; content: string }>): Map<string, DocumentChunk[]> {
    const results = new Map<string, DocumentChunk[]>();

    for (const doc of docs) {
      const chunks = this.chunkDocument(doc.hash, doc.content);
      results.set(doc.hash, chunks);
    }

    return results;
  }

  /**
   * Get chunking statistics for diagnostics
   */
  getChunkingStats(chunks: DocumentChunk[]): {
    totalChunks: number;
    avgTokensPerChunk: number;
    maxTokensInChunk: number;
    minTokensInChunk: number;
  } {
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        avgTokensPerChunk: 0,
        maxTokensInChunk: 0,
        minTokensInChunk: 0,
      };
    }

    const tokenCounts = chunks.map(c => c.tokenCount);
    const sum = tokenCounts.reduce((a, b) => a + b, 0);

    return {
      totalChunks: chunks.length,
      avgTokensPerChunk: Math.round(sum / chunks.length),
      maxTokensInChunk: Math.max(...tokenCounts),
      minTokensInChunk: Math.min(...tokenCounts),
    };
  }
}

export { DEFAULT_OPTIONS };
