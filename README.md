# mcp-schema-validator

> Runtime schema validation middleware for MCP tool inputs and outputs.

[![npm version](https://img.shields.io/npm/v/mcp-schema-validator)](https://www.npmjs.com/package/mcp-schema-validator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Standard Schema](https://img.shields.io/badge/Standard%20Schema-compatible-blue)](https://standardschema.dev)

MCP tool schemas are declared but rarely validated at runtime. Malformed LLM inputs cause cryptic errors deep in your handlers. This library wraps any MCP server with a composable validation middleware in **one line**.

---

## Features

- **Runtime validation** for all tool inputs and outputs (Zod v3/v4, Valibot, ArkType)
- **LLM-friendly errors** - structured messages that tell the model exactly what went wrong
- **Type-safe schema registry** - write once, validate everywhere, infer TypeScript types for free
- **Drop-in wrapper** - one function call wraps your existing handler
- **Composable middleware** - chain with rate-limiter, audit-log, and your own middleware
- **Strict mode** - reject any tool call where schema is undeclared
- **Soft mode** - log violations without blocking (safe for gradual rollout)

---

## Installation

```bash
npm install mcp-schema-validator
# peer deps
npm install @standard-schema/spec
# pick your schema library
npm install zod          # or valibot, or arktype
```

---

## Quick Start

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createRegistry, withValidation } from "mcp-schema-validator";

// 1. Declare schemas once - TypeScript types inferred automatically
const registry = createRegistry()
  .register("search", {
    input: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(10),
    }),
    output: z.object({
      results: z.array(z.string()),
      total: z.number(),
    }),
  })
  .build();

// 2. Your handler stays clean - no validation boilerplate
async function handler(req) {
  // ...fetch results...
  return { content: [{ type: "text", text: JSON.stringify({ results: [], total: 0 }) }] };
}

// 3. Wrap in one line
server.setRequestHandler(
  CallToolRequestSchema,
  withValidation(registry, handler, { mode: "strict" })
);
```

---

## Schema Libraries

This library uses the [Standard Schema](https://standardschema.dev) interface. Any compatible library works identically:

```ts
// Zod
import { z } from "zod";
const schema = z.object({ query: z.string() });

// Valibot
import * as v from "valibot";
const schema = v.object({ query: v.string() });

// ArkType
import { type } from "arktype";
const schema = type({ query: "string" });
```

---

## Middleware Composition

```ts
import { compose, withLogger, withRateLimit, withAuditLog } from "mcp-schema-validator";

const pipeline = compose(
  withLogger(),
  withRateLimit({ maxRpm: 60 }),
  withAuditLog({ onRecord: (r) => db.insert(r) })
);

const validatedHandler = withValidation(registry, pipeline(rawHandler), { mode: "strict" });
```

---

## Strict vs. Soft Mode

| Mode | Unregistered tool | Invalid input | Invalid output |
|------|-------------------|---------------|----------------|
| `strict` (default) | ❌ Blocked, error returned | ❌ Blocked | ❌ Blocked |
| `soft` | ⚠️ Logged, continues | ⚠️ Logged, continues | ⚠️ Logged, continues |

Soft mode is ideal for gradual rollout - instrument first, enforce later.

```ts
withValidation(registry, handler, {
  mode: "soft",
  onSoftViolation: (tool, phase, errors) => {
    metrics.increment("mcp.violation", { tool, phase });
  },
})
```

---

## Error Format

When validation fails in strict mode, the LLM receives a structured, actionable message:

```
Tool "search" failed input validation.

The following fields are invalid:
  • [limit]: Number must be less than or equal to 100
  • [query]: String must contain at least 1 character(s)

Please correct your arguments and retry.
```

---

## API Reference

### `withValidation(registry, handler, options?)`

Wraps a tool handler with input + output validation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `registry` | `SchemaRegistry` | Map of tool name → `{ input?, output? }` schemas |
| `handler` | `ToolHandler` | Your existing MCP CallToolRequest handler |
| `options.mode` | `"strict" \| "soft"` | Default: `"strict"` |
| `options.onValidationError` | `fn` | Called when validation fails |
| `options.onSoftViolation` | `fn` | Called for soft-mode violations |
| `options.logger` | `Console` | Custom logger |

### `createRegistry()`

Fluent builder for type-safe schema registration. Returns a `SchemaRegistryBuilder`.

```ts
const registry = createRegistry()
  .register("tool_name", { input: schema, output: schema })
  .merge(otherBuilder)
  .build();
```

### `compose(...middlewares)`

Left-to-right middleware composition. First middleware runs first (outermost).

### `withLogger(options?)` · `withRateLimit(options)` · `withAuditLog(options)`

Built-in middleware. See TypeScript types for full option shapes.

---

## License

MIT © [ConfigKits](https://github.com/configkits)
