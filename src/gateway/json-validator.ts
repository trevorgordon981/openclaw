/**
 * JSON Validation - Pre-validate JSON before processing
 * - Depth checking
 * - Circular reference detection
 * - Sanitization
 */

export interface JSONValidationConfig {
  maxDepth: number;
  maxSize: number; // bytes
  allowedRootTypes: ("object" | "array" | "string" | "number" | "boolean" | "null")[];
  sanitize: boolean;
}

export interface ValidationError {
  code: string;
  message: string;
  path?: string;
}

/**
 * Validates and sanitizes JSON structures
 */
export class JSONValidator {
  private config: JSONValidationConfig;

  constructor(config: Partial<JSONValidationConfig> = {}) {
    this.config = {
      maxDepth: config.maxDepth ?? 20,
      maxSize: config.maxSize ?? 10 * 1024 * 1024, // 10MB
      allowedRootTypes: config.allowedRootTypes ?? ["object", "array"],
      sanitize: config.sanitize ?? true,
    };
  }

  /**
   * Validate a JSON string
   */
  validateString(jsonStr: string): { valid: boolean; data?: unknown; errors: ValidationError[] } {
    // Check size
    if (jsonStr.length > this.config.maxSize) {
      return {
        valid: false,
        errors: [
          {
            code: "SIZE_EXCEEDED",
            message: `JSON size (${jsonStr.length} bytes) exceeds maximum (${this.config.maxSize} bytes)`,
          },
        ],
      };
    }

    // Parse JSON
    let data: unknown;
    try {
      data = JSON.parse(jsonStr);
    } catch (err) {
      return {
        valid: false,
        errors: [
          {
            code: "PARSE_ERROR",
            message: `Invalid JSON: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
        ],
      };
    }

    // Validate parsed object
    return this.validateObject(data);
  }

  /**
   * Validate a parsed JSON object
   */
  validateObject(data: unknown): { valid: boolean; data?: unknown; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    // Check root type
    const rootType = this.getType(data);
    if (!this.config.allowedRootTypes.includes(rootType)) {
      errors.push({
        code: "INVALID_ROOT_TYPE",
        message: `Root must be one of: ${this.config.allowedRootTypes.join(", ")}`,
      });
      return { valid: false, errors };
    }

    // Check depth
    const depthErrors = this.checkDepth(data, 0, []);
    errors.push(...depthErrors);

    // Check for circular references
    const circularErrors = this.checkCircular(data, []);
    errors.push(...circularErrors);

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Sanitize if enabled
    const sanitized = this.config.sanitize ? this.sanitize(data) : data;

    return {
      valid: true,
      data: sanitized,
      errors: [],
    };
  }

  /**
   * Check nesting depth
   */
  private checkDepth(
    data: unknown,
    currentDepth: number,
    path: (string | number)[],
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (currentDepth > this.config.maxDepth) {
      errors.push({
        code: "DEPTH_EXCEEDED",
        message: `Nesting depth (${currentDepth}) exceeds maximum (${this.config.maxDepth})`,
        path: this.formatPath(path),
      });
      return errors;
    }

    if (typeof data === "object" && data !== null) {
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          errors.push(...this.checkDepth(data[i], currentDepth + 1, [...path, i]));
        }
      } else {
        for (const [key, value] of Object.entries(data)) {
          errors.push(...this.checkDepth(value, currentDepth + 1, [...path, key]));
        }
      }
    }

    return errors;
  }

  /**
   * Detect circular references
   */
  private checkCircular(data: unknown, seen: unknown[]): ValidationError[] {
    const errors: ValidationError[] = [];

    if (typeof data === "object" && data !== null) {
      if (seen.includes(data)) {
        return [
          {
            code: "CIRCULAR_REFERENCE",
            message: "Circular reference detected",
          },
        ];
      }

      const newSeen = [...seen, data];

      if (Array.isArray(data)) {
        for (const item of data) {
          errors.push(...this.checkCircular(item, newSeen));
        }
      } else {
        for (const value of Object.values(data)) {
          errors.push(...this.checkCircular(value, newSeen));
        }
      }
    }

    return errors;
  }

  /**
   * Sanitize JSON by removing dangerous patterns
   */
  private sanitize(data: unknown): unknown {
    if (data === null || typeof data !== "object") {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      // Skip suspicious keys
      if (this.isSuspiciousKey(key)) {
        continue;
      }

      sanitized[key] = this.sanitize(value);
    }

    return sanitized;
  }

  /**
   * Check if key looks suspicious (e.g., proto, constructor, __proto__)
   */
  private isSuspiciousKey(key: string): boolean {
    const suspicious = ["__proto__", "constructor", "prototype"];
    return suspicious.includes(key);
  }

  /**
   * Get type of value
   */
  private getType(value: unknown): "object" | "array" | "string" | "number" | "boolean" | "null" {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof value === "object") return "object";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    return "null"; // fallback
  }

  /**
   * Format path for error messages
   */
  private formatPath(path: (string | number)[]): string {
    return (
      "$" +
      path
        .map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`))
        .join("")
        .replace(/^\.\$/, "$")
    );
  }

  /**
   * Get estimated size of object in bytes
   */
  estimateSize(data: unknown): number {
    return JSON.stringify(data).length;
  }

  /**
   * Get depth of object
   */
  getDepth(data: unknown): number {
    if (typeof data !== "object" || data === null) {
      return 0;
    }

    let maxDepth = 0;

    if (Array.isArray(data)) {
      for (const item of data) {
        maxDepth = Math.max(maxDepth, this.getDepth(item));
      }
    } else {
      for (const value of Object.values(data)) {
        maxDepth = Math.max(maxDepth, this.getDepth(value));
      }
    }

    return maxDepth + 1;
  }
}
