/**
 * mcp-schema-validator — Runtime schema validation middleware for MCP tool inputs/outputs
 * @configkits/mcp-schema-validator
 *
 * Compatible with the Standard Schema interface (Zod v3/v4, Valibot, ArkType)
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnyStandardSchema = StandardSchemaV1<unknown, unknown>;

export interface ToolSchema {
  input?: AnyStandardSchema;
  output?: AnyStandardSchema;
}

export interface SchemaRegistry {
  [toolName: string]: ToolSchema;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidatorOptions {
  /**
   * "strict" — reject tool calls with no registered schema (default)
   * "soft"   — log violations, never block (safe for gradual rollout)
   */
  mode?: "strict" | "soft";

  /** Called on validation failure before the error is returned. */
  onValidationError?: (
    toolName: string,
    phase: "input" | "output",
    errors: ValidationError[]
  ) => void | Promise<void>;

  /** Called in soft mode when a violation is logged. */
  onSoftViolation?: (
    toolName: string,
    phase: "input" | "output",
    errors: ValidationError[]
  ) => void | Promise<void>;

  /** Custom logger (default: console). */
  logger?: Pick<Console, "warn" | "error">;
}

export interface MCPToolCallRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

export type ToolHandler = (
  request: MCPToolCallRequest
) => Promise<MCPToolCallResult>;

// ─── Normalise Standard Schema issues ────────────────────────────────────────

function normaliseIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>
): ValidationError[] {
  return issues.map((issue) => ({
    path: issue.path
      ? issue.path.map((p) => (typeof p === "object" ? p.key : p)).join(".")
      : "(root)",
    message: issue.message,
  }));
}

// ─── Validate against a Standard Schema ──────────────────────────────────────

async function validate(
  schema: AnyStandardSchema,
  value: unknown
): Promise<ValidationError[] | null> {
  const result = await schema["~standard"].validate(value);
  if (result.issues && result.issues.length > 0) {
    return normaliseIssues(result.issues);
  }
  return null;
}

// ─── Build an LLM-friendly error response ────────────────────────────────────

function buildErrorResponse(
  toolName: string,
  phase: "input" | "output",
  errors: ValidationError[]
): MCPToolCallResult {
  const bullet = errors
    .map((e) => `  • [${e.path}]: ${e.message}`)
    .join("\n");

  const message =
    `Tool "${toolName}" failed ${phase} validation.\n\n` +
    `The following fields are invalid:\n${bullet}\n\n` +
    `Please correct your ${phase === "input" ? "arguments" : "tool implementation"} and retry.`;

  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Wraps a tool handler with schema validation for inputs and outputs.
 *
 * @example
 * ```ts
 * import { withValidation } from "@configkits/mcp-schema-validator";
 * import { z } from "zod";
 *
 * const registry = {
 *   search: {
 *     input:  z.object({ query: z.string(), limit: z.number().int().min(1).max(100) }),
 *     output: z.object({ results: z.array(z.string()) }),
 *   },
 * };
 *
 * server.setRequestHandler(CallToolRequestSchema, withValidation(registry, originalHandler));
 * ```
 */
export function withValidation(
  registry: SchemaRegistry,
  handler: ToolHandler,
  options: ValidatorOptions = {}
): ToolHandler {
  const {
    mode = "strict",
    onValidationError,
    onSoftViolation,
    logger = console,
  } = options;

  return async (request: MCPToolCallRequest): Promise<MCPToolCallResult> => {
    const { name: toolName, arguments: args = {} } = request;
    const schema = registry[toolName];

    // ── Schema-not-found handling ──
    if (!schema) {
      if (mode === "strict") {
        return buildErrorResponse(toolName, "input", [
          {
            path: "(registry)",
            message: `No schema registered for tool "${toolName}". Register a schema or switch to soft mode.`,
          },
        ]);
      }
      logger.warn(
        `[mcp-schema-validator] No schema for tool "${toolName}" (soft mode — continuing)`
      );
      return handler(request);
    }

    // ── Input validation ──
    if (schema.input) {
      const inputErrors = await validate(schema.input, args);
      if (inputErrors) {
        await onValidationError?.(toolName, "input", inputErrors);
        if (mode === "soft") {
          await onSoftViolation?.(toolName, "input", inputErrors);
          logger.warn(
            `[mcp-schema-validator] Input violation for "${toolName}":`,
            inputErrors
          );
        } else {
          return buildErrorResponse(toolName, "input", inputErrors);
        }
      }
    }

    // ── Invoke handler ──
    const result = await handler(request);

    // ── Output validation ──
    if (schema.output && !result.isError) {
      const rawOutput = result.content.find((c) => c.type === "text")?.text;

      let parsed: unknown = rawOutput;
      try {
        if (typeof rawOutput === "string") parsed = JSON.parse(rawOutput);
      } catch {
        // not JSON — validate as-is
      }

      const outputErrors = await validate(schema.output, parsed);
      if (outputErrors) {
        await onValidationError?.(toolName, "output", outputErrors);
        if (mode === "soft") {
          await onSoftViolation?.(toolName, "output", outputErrors);
          logger.warn(
            `[mcp-schema-validator] Output violation for "${toolName}":`,
            outputErrors
          );
        } else {
          return buildErrorResponse(toolName, "output", outputErrors);
        }
      }
    }

    return result;
  };
}
