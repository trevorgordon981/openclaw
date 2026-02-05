/**
 * Response Truncation (Item 7)
 * Smart truncation at sentence boundaries
 * Customizable max tokens
 * ~5% cost savings
 */

export interface TruncationOptions {
  maxTokens: number;
  truncateAtSentence: boolean;
  preserveCodeBlocks: boolean;
  ellipsisIndicator: string;
}

/**
 * Handles smart response truncation
 */
export class ResponseTruncator {
  private options: TruncationOptions;

  constructor(options: Partial<TruncationOptions> = {}) {
    this.options = {
      maxTokens: options.maxTokens ?? 4000,
      truncateAtSentence: options.truncateAtSentence ?? true,
      preserveCodeBlocks: options.preserveCodeBlocks ?? true,
      ellipsisIndicator: options.ellipsisIndicator ?? "...",
    };
  }

  /**
   * Truncate text based on token limit
   */
  truncate(text: string): { truncated: string; wasTruncated: boolean; tokenCount: number } {
    const estimatedTokens = this.estimateTokens(text);

    if (estimatedTokens <= this.options.maxTokens) {
      return {
        truncated: text,
        wasTruncated: false,
        tokenCount: estimatedTokens,
      };
    }

    let result = text;

    // First pass: truncate by approximate tokens
    const tokenRatio = this.options.maxTokens / estimatedTokens;
    const charLimit = Math.floor(text.length * tokenRatio);
    result = text.substring(0, charLimit);

    // Second pass: handle sentence boundaries if enabled
    if (this.options.truncateAtSentence) {
      result = this.truncateAtSentence(result);
    }

    // Third pass: preserve code blocks if enabled
    if (this.options.preserveCodeBlocks) {
      result = this.preserveCodeBlocks(result, text);
    }

    // Add ellipsis
    if (!result.endsWith(this.options.ellipsisIndicator)) {
      result += this.options.ellipsisIndicator;
    }

    return {
      truncated: result,
      wasTruncated: true,
      tokenCount: this.estimateTokens(result),
    };
  }

  /**
   * Truncate at last sentence boundary
   */
  private truncateAtSentence(text: string): string {
    // Match sentence endings: . ? ! followed by space
    const sentenceRegex = /[.!?]\s+/g;
    let lastMatch = null;
    let match;

    while ((match = sentenceRegex.exec(text)) !== null) {
      lastMatch = match;
    }

    if (lastMatch) {
      return text.substring(0, lastMatch.index + 1);
    }

    // Fallback to last paragraph
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline > text.length * 0.8) {
      return text.substring(0, lastNewline);
    }

    return text;
  }

  /**
   * Preserve code blocks by not truncating inside them
   */
  private preserveCodeBlocks(truncated: string, original: string): string {
    // Count opening and closing backticks
    const openCount = (truncated.match(/```/g) || []).length;
    const closeCount = (truncated.match(/```/g) || []).length;

    // If we're inside a code block, remove it
    if (openCount % 2 !== 0) {
      // Find last code block start
      const lastCodeStart = truncated.lastIndexOf("```");
      if (lastCodeStart > -1) {
        return truncated.substring(0, lastCodeStart).trimEnd();
      }
    }

    return truncated;
  }

  /**
   * Estimate token count (rough approximation)
   * Actual token count varies by model
   * This uses: ~4 characters per token average
   */
  estimateTokens(text: string): number {
    // Split by whitespace and punctuation
    const words = text.split(/\s+/).length;
    const charCount = text.length;

    // Rough estimate: 4 chars per token, but words also count
    return Math.ceil(Math.max(words * 1.3, charCount / 4));
  }

  /**
   * Get truncation statistics
   */
  getStats(
    original: string,
    truncated: string,
  ): {
    originalTokens: number;
    truncatedTokens: number;
    reductionPercent: number;
    charReduction: number;
  } {
    const originalTokens = this.estimateTokens(original);
    const truncatedTokens = this.estimateTokens(truncated);
    const reduction = ((originalTokens - truncatedTokens) / originalTokens) * 100;

    return {
      originalTokens,
      truncatedTokens,
      reductionPercent: Math.round(reduction * 100) / 100,
      charReduction: original.length - truncated.length,
    };
  }

  /**
   * Update truncation options
   */
  setOptions(options: Partial<TruncationOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
  }

  /**
   * Get current options
   */
  getOptions(): TruncationOptions {
    return { ...this.options };
  }
}
