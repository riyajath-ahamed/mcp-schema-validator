/**
 * Middleware composition — chain multiple middleware layers together.
 * Follows the same ToolHandler → ToolHandler signature throughout.
 *
 * @example
 * ```ts
 * import { compose, withValidation, withRateLimit, withAuditLog } from "@configkits/mcp-schema-validator";
 *
 * const wrapped = compose(
 *   withValidation(registry, { mode: "strict" }),
 *   withRateLimit({ maxRpm: 60 }),
 *   withAuditLog({ destination: "stdout" })
 * )(rawHandler);
 * ```
 */

import type { ToolHandler, MCPToolCallRequest, MCPToolCallResult } from "./validator";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A middleware is a function that takes a handler and returns a new handler.
 */
export type Middleware = (next: ToolHandler) => ToolHandler;

// ─── compose ─────────────────────────────────────────────────────────────────

/**
 * Compose middleware left-to-right.
 * The first middleware listed runs first (outermost wrapper).
 *
 * @example
 * ```ts
 * const pipeline = compose(A, B, C);
 * // Execution order on a call: A → B → C → handler → C → B → A
 * ```
 */
export function compose(...middlewares: Middleware[]): Middleware {
  if (middlewares.length === 0) return (next) => next;
  if (middlewares.length === 1) return middlewares[0]!;

  return (next: ToolHandler): ToolHandler =>
    middlewares.reduceRight((acc, mw) => mw(acc), next);
}

// ─── Built-in lightweight middleware ─────────────────────────────────────────

/**
 * Simple request logger middleware.
 */
export function withLogger(
  options: {
    logger?: Pick<Console, "log" | "warn" | "error">;
    includeArgs?: boolean;
  } = {}
): Middleware {
  const { logger = console, includeArgs = false } = options;

  return (next) =>
    async (request): Promise<MCPToolCallResult> => {
      const start = Date.now();
      logger.log(`[mcp] → ${request.name}${includeArgs ? ` ${JSON.stringify(request.arguments)}` : ""}`);
      try {
        const result = await next(request);
        const ms = Date.now() - start;
        if (result.isError) {
          logger.warn(`[mcp] ✗ ${request.name} (${ms}ms) — error`);
        } else {
          logger.log(`[mcp] ✓ ${request.name} (${ms}ms)`);
        }
        return result;
      } catch (err) {
        logger.error(`[mcp] ✗ ${request.name} threw:`, err);
        throw err;
      }
    };
}

/**
 * Naive in-memory rate limiter middleware (requests per minute per tool).
 * For production use, swap this for a Redis-backed implementation.
 */
export function withRateLimit(options: {
  maxRpm: number;
  perTool?: boolean;
}): Middleware {
  const { maxRpm, perTool = true } = options;
  const buckets = new Map<string, number[]>();

  return (next) =>
    async (request): Promise<MCPToolCallResult> => {
      const key = perTool ? request.name : "__global__";
      const now = Date.now();
      const window = 60_000;

      const timestamps = (buckets.get(key) ?? []).filter(
        (t) => now - t < window
      );

      if (timestamps.length >= maxRpm) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Rate limit exceeded for tool "${request.name}". Maximum ${maxRpm} requests/minute. Please wait before retrying.`,
            },
          ],
        };
      }

      timestamps.push(now);
      buckets.set(key, timestamps);

      return next(request);
    };
}

/**
 * Audit log middleware — appends structured call records to a log callback.
 */
export interface AuditRecord {
  timestamp: string;
  toolName: string;
  durationMs: number;
  isError: boolean;
  arguments?: Record<string, unknown>;
}

export function withAuditLog(options: {
  onRecord: (record: AuditRecord) => void | Promise<void>;
  includeArguments?: boolean;
}): Middleware {
  const { onRecord, includeArguments = false } = options;

  return (next) =>
    async (request): Promise<MCPToolCallResult> => {
      const start = Date.now();
      const result = await next(request);

      await onRecord({
        timestamp: new Date().toISOString(),
        toolName: request.name,
        durationMs: Date.now() - start,
        isError: result.isError ?? false,
        ...(includeArguments ? { arguments: request.arguments } : {}),
      });

      return result;
    };
}
