/**
 * Example: Full MCP server with mcp-schema-validator
 *
 * Demonstrates:
 *  - createRegistry() for type-safe schema registration
 *  - withValidation() as a drop-in handler wrapper
 *  - compose() for chaining rate-limiter + audit log + validation
 *  - strict mode (default) vs. soft mode
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  createRegistry,
  withValidation,
  compose,
  withLogger,
  withRateLimit,
  withAuditLog,
} from "mcp-schema-validator";

// ─── 1. Define schemas once ───────────────────────────────────────────────────

const registry = createRegistry()
  .register("search", {
    input: z.object({
      query: z.string().min(1).describe("Search query"),
      limit: z.number().int().min(1).max(100).default(10),
      filters: z
        .object({
          dateFrom: z.string().datetime().optional(),
          dateTo: z.string().datetime().optional(),
          category: z.enum(["news", "docs", "code"]).optional(),
        })
        .optional(),
    }),
    output: z.object({
      results: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          url: z.string().url(),
          score: z.number().min(0).max(1),
        })
      ),
      total: z.number().int(),
      took_ms: z.number(),
    }),
  })
  .register("create_task", {
    input: z.object({
      title: z.string().min(1).max(200),
      priority: z.enum(["low", "medium", "high", "critical"]),
      assignee: z.string().email().optional(),
      due_date: z.string().datetime().optional(),
    }),
  })
  .register("echo", {
    input: z.object({ text: z.string() }),
  })
  .build();

// ─── 2. Raw handlers (no validation boilerplate needed) ───────────────────────

async function rawHandler(request: { name: string; arguments?: Record<string, unknown> }) {
  switch (request.name) {
    case "search":
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              results: [
                { id: "1", title: "Result A", url: "https://example.com/a", score: 0.95 },
                { id: "2", title: "Result B", url: "https://example.com/b", score: 0.82 },
              ],
              total: 2,
              took_ms: 12,
            }),
          },
        ],
      };

    case "create_task":
      return {
        content: [{ type: "text" as const, text: "Task created successfully." }],
      };

    case "echo":
      return {
        content: [{ type: "text" as const, text: (request.arguments as { text: string }).text }],
      };

    default:
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Unknown tool: ${request.name}` }],
      };
  }
}

// ─── 3. Compose middleware pipeline ──────────────────────────────────────────

const auditLog: Array<{ tool: string; ok: boolean; ms: number }> = [];

const pipeline = compose(
  withLogger({ includeArgs: false }),
  withRateLimit({ maxRpm: 60 }),
  withAuditLog({
    includeArguments: false,
    onRecord: (rec) => {
      auditLog.push({ tool: rec.toolName, ok: !rec.isError, ms: rec.durationMs });
    },
  })
);

// ─── 4. Drop-in wrapper — one line ───────────────────────────────────────────

const validatedHandler = withValidation(
  registry,
  pipeline(rawHandler),
  {
    mode: "strict",
    onValidationError: (tool, phase, errors) => {
      console.error(`Validation failed: ${tool} / ${phase}`, errors);
    },
  }
);

// ─── 5. Wire up MCP server ────────────────────────────────────────────────────

const server = new McpServer({
  name: "my-production-server",
  version: "1.0.0",
});

server.tool("search", "Search across data sources", rawHandler as any);
server.tool("create_task", "Create a new task", rawHandler as any);
server.tool("echo", "Echo text back", rawHandler as any);

// Override the CallToolRequest handler with our validated pipeline
(server as any).server.setRequestHandler(CallToolRequestSchema, validatedHandler);

const transport = new StdioServerTransport();
await server.connect(transport);

console.log("MCP server running with schema validation ✓");
