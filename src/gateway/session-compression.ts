/**
 * Session Compression (Item 9)
 * Compress old messages in long-running sessions
 * Configurable retention of recent messages
 * ~4% cost savings
 */

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface CompressedSession {
  originalMessageCount: number;
  compressedMessageCount: number;
  compressionRatio: number;
  summary?: string;
  recentMessages: Message[];
  createdAt: number;
}

/**
 * Manages session compression for long-running conversations
 */
export class SessionCompressor {
  private compressionThreshold: number;
  private retentionWindow: number;
  private summaryStrategy: "abstract" | "keyhighlights" | "combined";
  private aggressiveAfterHours: number;

  constructor(
    compressionThreshold: number = 300,
    retentionWindow: number = 30,
    summaryStrategy: "abstract" | "keyhighlights" | "combined" = "keyhighlights",
    aggressiveAfterHours: number = 2,
  ) {
    this.compressionThreshold = compressionThreshold;
    this.retentionWindow = retentionWindow;
    this.summaryStrategy = summaryStrategy;
    this.aggressiveAfterHours = aggressiveAfterHours;
  }

  /**
   * Check if session should be compressed
   */
  shouldCompress(messages: Message[], sessionAgeHours: number): boolean {
    if (messages.length < this.compressionThreshold) {
      return false;
    }

    // More aggressive compression for older sessions
    if (sessionAgeHours > this.aggressiveAfterHours) {
      return messages.length > this.retentionWindow + 50;
    }

    return true;
  }

  /**
   * Compress session messages
   */
  compress(messages: Message[], sessionAgeHours: number = 0): CompressedSession {
    if (!this.shouldCompress(messages, sessionAgeHours)) {
      return {
        originalMessageCount: messages.length,
        compressedMessageCount: messages.length,
        compressionRatio: 0,
        recentMessages: messages,
        createdAt: Date.now(),
      };
    }

    // Keep recent messages
    const recentMessages = messages.slice(-this.retentionWindow);
    const compressableMessages = messages.slice(0, -this.retentionWindow);

    // Generate summary
    const summary = this.generateSummary(compressableMessages, this.summaryStrategy);

    // Create compressed session with summary as single message
    const compressedMessages: Message[] = [];

    if (summary) {
      compressedMessages.push({
        id: `compressed-${Date.now()}`,
        role: "assistant",
        content: summary,
        timestamp: compressableMessages[0]?.timestamp || Date.now(),
      });
    }

    compressedMessages.push(...recentMessages);

    const compressionRatio = (messages.length - compressedMessages.length) / messages.length;

    return {
      originalMessageCount: messages.length,
      compressedMessageCount: compressedMessages.length,
      compressionRatio: Math.round(compressionRatio * 10000) / 100,
      summary,
      recentMessages: compressedMessages,
      createdAt: Date.now(),
    };
  }

  /**
   * Generate summary based on strategy
   */
  private generateSummary(
    messages: Message[],
    strategy: "abstract" | "keyhighlights" | "combined",
  ): string {
    if (messages.length === 0) {
      return "";
    }

    let summary = "";

    if (strategy === "abstract" || strategy === "combined") {
      summary += this.generateAbstractSummary(messages);
    }

    if (strategy === "keyhighlights" || strategy === "combined") {
      const highlights = this.extractKeyHighlights(messages);
      if (highlights.length > 0) {
        summary += highlights.length > 0 ? "\nKey points:\n" : "";
        summary += highlights.join("\n");
      }
    }

    return summary.trim();
  }

  /**
   * Generate abstract summary
   */
  private generateAbstractSummary(messages: Message[]): string {
    const assistantMessages = messages.filter((m) => m.role === "assistant");
    const userMessages = messages.filter((m) => m.role === "user");

    const userTopics = this.extractTopics(userMessages.map((m) => m.content).join(" "));
    const assistantSummary = assistantMessages
      .slice(-2)
      .map((m) => m.content.split("\n")[0])
      .join(" ");

    return (
      `[Previous conversation context: ${userMessages.length} user messages, ` +
      `${assistantMessages.length} assistant responses. Topics: ${userTopics.join(", ")}. ` +
      `Last response: ${assistantSummary}]`
    );
  }

  /**
   * Extract key highlights from messages
   */
  private extractKeyHighlights(messages: Message[]): string[] {
    const highlights: string[] = [];

    for (const message of messages) {
      // Look for sentences with action items, decisions, or key info
      const sentences = message.content.split(/[.!?]\s+/);

      for (const sentence of sentences) {
        if (
          /\b(decided|concluded|important|key|note|question|answer|confirmed|TODO|action)\b/i.test(
            sentence,
          )
        ) {
          const trimmed = sentence.trim();
          if (trimmed.length > 10 && trimmed.length < 150) {
            highlights.push(`- ${trimmed}`);
          }
        }
      }
    }

    return highlights.slice(0, 10); // Limit to 10 highlights
  }

  /**
   * Extract main topics from text
   */
  private extractTopics(text: string): string[] {
    // Simple keyword extraction based on capitalized words and common patterns
    const words = text.split(/\s+/);
    const topics = new Set<string>();

    for (const word of words) {
      if (word.length > 5 && /^[A-Z]/.test(word)) {
        topics.add(word.toLowerCase().replace(/[,.:;]/g, ""));
      }
    }

    return Array.from(topics).slice(0, 3);
  }

  /**
   * Update compression settings
   */
  updateSettings(
    compressionThreshold?: number,
    retentionWindow?: number,
    summaryStrategy?: "abstract" | "keyhighlights" | "combined",
  ): void {
    if (compressionThreshold !== undefined) {
      this.compressionThreshold = compressionThreshold;
    }
    if (retentionWindow !== undefined) {
      this.retentionWindow = retentionWindow;
    }
    if (summaryStrategy !== undefined) {
      this.summaryStrategy = summaryStrategy;
    }
  }

  /**
   * Get compression statistics
   */
  static getStats(
    original: Message[],
    compressed: Message[],
  ): {
    messageReduction: number;
    tokenEstimateSavings: number;
  } {
    const originalTokens = original.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
    const compressedTokens = compressed.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0,
    );

    return {
      messageReduction: original.length - compressed.length,
      tokenEstimateSavings: originalTokens - compressedTokens,
    };
  }
}
