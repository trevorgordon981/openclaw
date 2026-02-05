/**
 * Tool Filtering (Item 8)
 * Only expose relevant tools per task
 * Context + complexity-based filtering
 * ~3% cost savings
 */

export interface Tool {
  name: string;
  description: string;
  category?: string;
  keywords?: string[];
  complexity?: "simple" | "moderate" | "complex";
}

export interface FilteringStrategy {
  minRelevanceScore: number;
  maxTools: number;
  exposureMode: "minimal" | "balanced" | "full";
  enableSemanticMatching: boolean;
}

/**
 * Filters tools based on task context and complexity
 */
export class ToolFilter {
  private tools: Map<string, Tool> = new Map();
  private strategy: FilteringStrategy;

  constructor(strategy: Partial<FilteringStrategy> = {}) {
    this.strategy = {
      minRelevanceScore: strategy.minRelevanceScore ?? 0.6,
      maxTools: strategy.maxTools ?? 10,
      exposureMode: strategy.exposureMode ?? "balanced",
      enableSemanticMatching: strategy.enableSemanticMatching ?? true,
    };
  }

  /**
   * Register a tool
   */
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: Tool[]): void {
    tools.forEach((tool) => this.registerTool(tool));
  }

  /**
   * Filter tools based on task context
   */
  filterForTask(
    taskDescription: string,
    complexity: "simple" | "moderate" | "complex" = "moderate",
  ): Tool[] {
    const scored = this.scoreTools(taskDescription, complexity);

    // Filter by relevance score
    const filtered = scored.filter((item) => item.score >= this.strategy.minRelevanceScore);

    // Limit by max tools
    return filtered
      .sort((a, b) => b.score - a.score)
      .slice(0, this.strategy.maxTools)
      .map((item) => item.tool);
  }

  /**
   * Score all tools for relevance to task
   */
  private scoreTools(
    taskDescription: string,
    complexity: "simple" | "moderate" | "complex",
  ): Array<{ tool: Tool; score: number }> {
    const results: Array<{ tool: Tool; score: number }> = [];
    const lowerDesc = taskDescription.toLowerCase();

    for (const tool of this.tools.values()) {
      let score = 0;

      // Keyword matching
      if (tool.keywords) {
        const keywordMatches = tool.keywords.filter((kw) => lowerDesc.includes(kw.toLowerCase()));
        score += (keywordMatches.length / tool.keywords.length) * 0.4;
      }

      // Description matching (semantic)
      if (this.strategy.enableSemanticMatching) {
        const descSimilarity = this.calculateSimilarity(taskDescription, tool.description);
        score += descSimilarity * 0.4;
      }

      // Complexity matching
      if (tool.complexity) {
        if (
          (complexity === "simple" && tool.complexity === "simple") ||
          (complexity === "moderate" && tool.complexity === "moderate") ||
          (complexity === "complex" && tool.complexity === "complex")
        ) {
          score += 0.2;
        }
      }

      // Exposure mode adjustment
      if (this.strategy.exposureMode === "minimal") {
        // Only include highest-scoring tools
        score *= score > 0.7 ? 1.2 : 0.3;
      } else if (this.strategy.exposureMode === "full") {
        // Include all tools with less filtering
        score = Math.min(score + 0.1, 1);
      }

      results.push({ tool, score: Math.min(score, 1) });
    }

    return results;
  }

  /**
   * Simple similarity metric based on shared words
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\W+/));
    const words2 = new Set(text2.toLowerCase().split(/\W+/));

    if (words1.size === 0 || words2.size === 0) {
      return 0;
    }

    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) {
        intersection++;
      }
    }

    const union = words1.size + words2.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): Tool[] {
    return Array.from(this.tools.values()).filter((tool) => tool.category === category);
  }

  /**
   * Update filtering strategy
   */
  setStrategy(strategy: Partial<FilteringStrategy>): void {
    this.strategy = {
      ...this.strategy,
      ...strategy,
    };
  }

  /**
   * Get current strategy
   */
  getStrategy(): FilteringStrategy {
    return { ...this.strategy };
  }

  /**
   * Get statistics
   */
  stats(): {
    totalTools: number;
    toolsByComplexity: Record<string, number>;
    toolsByCategory: Record<string, number>;
  } {
    const tools = Array.from(this.tools.values());
    const byComplexity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const tool of tools) {
      const complexity = tool.complexity || "unknown";
      byComplexity[complexity] = (byComplexity[complexity] || 0) + 1;

      const category = tool.category || "uncategorized";
      byCategory[category] = (byCategory[category] || 0) + 1;
    }

    return {
      totalTools: tools.length,
      toolsByComplexity: byComplexity,
      toolsByCategory: byCategory,
    };
  }
}
