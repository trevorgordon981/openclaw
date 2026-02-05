/**
 * Model Tiering - Route tasks to optimal Claude models based on complexity
 * - Simple tasks → Claude Haiku 3.5 (faster, cheaper)
 * - Complex tasks → Claude Opus 4.1 (more capable)
 * Estimated savings: 15% cost reduction
 */

export enum ComplexityLevel {
  SIMPLE = "simple",
  MODERATE = "moderate",
  COMPLEX = "complex",
}

export interface ComplexityAssessment {
  level: ComplexityLevel;
  score: number; // 0-100
  factors: {
    hasCodeAnalysis: boolean;
    hasMultipleTools: boolean;
    requiresReasoning: boolean;
    highTokenCount: boolean;
    containsTechKeywords: boolean;
  };
  recommendedModel: string;
}

export class ModelTieringEngine {
  private readonly TECH_KEYWORDS = [
    "debug",
    "optimize",
    "architecture",
    "algorithm",
    "implement",
    "refactor",
    "design",
    "pattern",
    "data structure",
    "analysis",
    "complex",
    "reasoning",
    "code review",
    "performance",
  ];

  private readonly SIMPLE_THRESHOLD = 30;
  private readonly MODERATE_THRESHOLD = 70;

  /**
   * Assess task complexity and recommend model
   */
  assessComplexity(
    input: string,
    toolCount: number = 0,
    estimatedTokens: number = 0,
  ): ComplexityAssessment {
    const factors = this.extractComplexityFactors(input, toolCount, estimatedTokens);
    const score = this.calculateComplexityScore(factors);
    const level = this.determineLevel(score);
    const model = this.selectModel(level);

    return {
      level,
      score,
      factors,
      recommendedModel: model,
    };
  }

  private extractComplexityFactors(
    input: string,
    toolCount: number,
    tokenCount: number,
  ): ComplexityAssessment["factors"] {
    const lowerInput = input.toLowerCase();

    return {
      hasCodeAnalysis: /code|debug|optimize|implement|refactor/.test(lowerInput),
      hasMultipleTools: toolCount > 2,
      requiresReasoning: /analyze|evaluate|compare|explain|reason|think/.test(lowerInput),
      highTokenCount: tokenCount > 2000,
      containsTechKeywords: this.TECH_KEYWORDS.some((kw) => lowerInput.includes(kw)),
    };
  }

  private calculateComplexityScore(factors: ComplexityAssessment["factors"]): number {
    let score = 0;

    if (factors.hasCodeAnalysis) score += 25;
    if (factors.hasMultipleTools) score += 20;
    if (factors.requiresReasoning) score += 25;
    if (factors.highTokenCount) score += 15;
    if (factors.containsTechKeywords) score += 15;

    // Cap at 100
    return Math.min(score, 100);
  }

  private determineLevel(score: number): ComplexityLevel {
    if (score < this.SIMPLE_THRESHOLD) {
      return ComplexityLevel.SIMPLE;
    } else if (score < this.MODERATE_THRESHOLD) {
      return ComplexityLevel.MODERATE;
    } else {
      return ComplexityLevel.COMPLEX;
    }
  }

  /**
   * Select Claude model based on complexity level
   * Returns model ID for API consumption
   */
  selectModel(level: ComplexityLevel): string {
    const modelMap = {
      [ComplexityLevel.SIMPLE]: "claude-3-5-haiku-20241022", // Fast, cheap
      [ComplexityLevel.MODERATE]: "claude-3-5-sonnet-20241022", // Balanced
      [ComplexityLevel.COMPLEX]: "claude-opus-4-1-20250805", // Most capable
    };

    return modelMap[level];
  }

  /**
   * Estimate cost difference (for reporting)
   * Haiku is ~90% cheaper than Opus for same tokens
   */
  estimateCostSavings(
    simpleRequestsCount: number,
    totalRequestsCount: number,
  ): { savingsPercent: number; breakdown: string } {
    const simplePercent = (simpleRequestsCount / totalRequestsCount) * 100;
    // Simplified: assumes ~15% avg requests move to Haiku
    const estimatedSavings = simplePercent * 0.9 * 0.15;

    return {
      savingsPercent: Math.min(estimatedSavings, 15),
      breakdown: `${simpleRequestsCount} simple requests routed to Haiku (90% cheaper)`,
    };
  }
}
