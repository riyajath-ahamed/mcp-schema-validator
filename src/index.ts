/**
 * mcp-schema-validator
 *
 * Runtime schema validation middleware for MCP tool inputs and outputs.
 * Compatible with Zod v3/v4, Valibot, ArkType (Standard Schema interface).
 *
 * @example
 * ```ts
 * import { withValidation, createRegistry } from "mcp-schema-validator";
 * import { z } from "zod";
 *
 * const registry = createRegistry()
 *   .register("search", {
 *     input:  z.object({ query: z.string(), limit: z.number().int().min(1).max(100) }),
 *     output: z.object({ results: z.array(z.string()), total: z.number() }),
 *   })
 *   .build();
 *
 * server.setRequestHandler(
 *   CallToolRequestSchema,
 *   withValidation(registry, myHandler, { mode: "strict" })
 * );
 * ```
 */

export { withValidation } from "./validator";
export type {
  ToolSchema,
  SchemaRegistry,
  ValidationError,
  ValidatorOptions,
  MCPToolCallRequest,
  MCPToolCallResult,
  ToolHandler,
  AnyStandardSchema,
} from "./validator";

export { SchemaRegistryBuilder, createRegistry } from "./registry";

export { compose, withLogger, withRateLimit, withAuditLog } from "./middleware";
export type { Middleware, AuditRecord } from "./middleware";
