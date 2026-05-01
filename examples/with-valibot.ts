/**
 * Example: Using mcp-schema-validator with Valibot
 * The library is schema-agnostic — any Standard Schema compatible library works.
 */

import * as v from "valibot";
import { createRegistry, withValidation } from "@configkits/mcp-schema-validator";

const registry = createRegistry()
  .register("translate", {
    input: v.object({
      text: v.pipe(v.string(), v.minLength(1)),
      from: v.picklist(["en", "fr", "de", "ja", "zh"]),
      to: v.picklist(["en", "fr", "de", "ja", "zh"]),
    }),
    output: v.object({
      translated: v.string(),
      confidence: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    }),
  })
  .build();

async function handler(req: { name: string; arguments?: Record<string, unknown> }) {
  // ... your handler logic
  return { content: [{ type: "text" as const, text: '{"translated":"Bonjour","confidence":0.99}' }] };
}

// Identical API — only the schema library changes
export const validatedHandler = withValidation(registry, handler, { mode: "strict" });
