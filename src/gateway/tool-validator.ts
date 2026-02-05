/**
 * Tool Call Validation - Validate tool calls before execution
 * - Schema compliance checking
 * - Type validation
 * - Required parameter validation
 * Estimated savings: 5% cost by preventing invalid calls
 */

export interface ToolSchema {
  name: string;
  description?: string;
  parameters: {
    type: "object" | "array" | "string" | "number" | "boolean";
    properties?: Record<string, ParameterDefinition>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ParameterDefinition {
  type: string;
  description?: string;
  enum?: (string | number | boolean)[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface ToolCall {
  toolName: string;
  params: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  type: "type-mismatch" | "missing-required" | "invalid-value" | "schema-violation";
}

/**
 * Validates tool calls against their schemas
 */
export class ToolValidator {
  private schemas: Map<string, ToolSchema> = new Map();

  /**
   * Register a tool schema
   */
  registerTool(schema: ToolSchema): void {
    this.schemas.set(schema.name, schema);
  }

  /**
   * Register multiple tools
   */
  registerTools(schemas: ToolSchema[]): void {
    schemas.forEach((schema) => this.registerTool(schema));
  }

  /**
   * Validate a tool call
   */
  validate(toolCall: ToolCall): ValidationResult {
    const schema = this.schemas.get(toolCall.toolName);

    if (!schema) {
      return {
        valid: false,
        errors: [
          {
            field: "toolName",
            message: `Unknown tool: ${toolCall.toolName}`,
            type: "schema-violation",
          },
        ],
        warnings: [],
      };
    }

    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Validate required parameters
    if (schema.parameters.required) {
      for (const requiredParam of schema.parameters.required) {
        if (!(requiredParam in toolCall.params)) {
          errors.push({
            field: requiredParam,
            message: `Required parameter '${requiredParam}' is missing`,
            type: "missing-required",
          });
        }
      }
    }

    // Validate each parameter
    if (schema.parameters.properties) {
      for (const [paramName, paramDef] of Object.entries(schema.parameters.properties)) {
        if (paramName in toolCall.params) {
          const paramValue = toolCall.params[paramName];
          this.validateParameter(paramName, paramValue, paramDef, errors, warnings);
        }
      }
    }

    // Check for unknown parameters
    if (schema.parameters.additionalProperties === false) {
      const allowedKeys = schema.parameters.properties
        ? Object.keys(schema.parameters.properties)
        : [];

      for (const key of Object.keys(toolCall.params)) {
        if (!allowedKeys.includes(key)) {
          warnings.push(`Unknown parameter '${key}' provided`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a single parameter
   */
  private validateParameter(
    name: string,
    value: unknown,
    definition: ParameterDefinition,
    errors: ValidationError[],
    warnings: string[],
  ): void {
    const paramType = typeof value;

    // Type checking
    if (!this.isValidType(value, definition.type)) {
      errors.push({
        field: name,
        message: `Expected type '${definition.type}', got '${paramType}'`,
        type: "type-mismatch",
      });
      return;
    }

    // Enum validation
    if (definition.enum && !definition.enum.includes(value as never)) {
      errors.push({
        field: name,
        message: `Value must be one of: ${definition.enum.join(", ")}`,
        type: "invalid-value",
      });
    }

    // String validations
    if (typeof value === "string") {
      if (definition.minLength && value.length < definition.minLength) {
        errors.push({
          field: name,
          message: `String length must be at least ${definition.minLength}`,
          type: "invalid-value",
        });
      }
      if (definition.maxLength && value.length > definition.maxLength) {
        errors.push({
          field: name,
          message: `String length must not exceed ${definition.maxLength}`,
          type: "invalid-value",
        });
      }
      if (definition.pattern) {
        const regex = new RegExp(definition.pattern);
        if (!regex.test(value)) {
          errors.push({
            field: name,
            message: `Value does not match required pattern: ${definition.pattern}`,
            type: "invalid-value",
          });
        }
      }
    }

    // Number validations
    if (typeof value === "number") {
      if (definition.minimum !== undefined && value < definition.minimum) {
        errors.push({
          field: name,
          message: `Value must be at least ${definition.minimum}`,
          type: "invalid-value",
        });
      }
      if (definition.maximum !== undefined && value > definition.maximum) {
        errors.push({
          field: name,
          message: `Value must not exceed ${definition.maximum}`,
          type: "invalid-value",
        });
      }
    }
  }

  /**
   * Check if value matches expected type
   */
  private isValidType(value: unknown, expectedType: string): boolean {
    const actualType = Array.isArray(value) ? "array" : typeof value;

    // Handle null/undefined
    if (value === null || value === undefined) {
      return expectedType === "null" || expectedType === "undefined";
    }

    return actualType === expectedType;
  }

  /**
   * Get summary of validation stats
   */
  getSummary(): {
    toolsRegistered: number;
    tools: string[];
  } {
    return {
      toolsRegistered: this.schemas.size,
      tools: Array.from(this.schemas.keys()),
    };
  }

  /**
   * Clear all schemas
   */
  clear(): void {
    this.schemas.clear();
  }
}
