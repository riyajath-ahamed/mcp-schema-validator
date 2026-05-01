/**
 * Tests for mcp-schema-validator
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { withValidation } from "../src/validator";
import { createRegistry } from "../src/registry";
import { compose, withLogger, withRateLimit, withAuditLog } from "../src/middleware";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const echoSchema = z.object({ text: z.string() });

const registry = createRegistry()
  .register("echo", { input: echoSchema })
  .register("search", {
    input: z.object({ query: z.string(), limit: z.number().int().min(1).max(100) }),
    output: z.object({ results: z.array(z.string()), total: z.number() }),
  })
  .build();

const okHandler = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: JSON.stringify({ results: ["a", "b"], total: 2 }) }],
});

function makeHandler(text: string) {
  return vi.fn().mockResolvedValue({ content: [{ type: "text", text }] });
}

// ─── withValidation ───────────────────────────────────────────────────────────

describe("withValidation — strict mode (default)", () => {
  it("passes valid inputs to the handler", async () => {
    const handler = makeHandler("ok");
    const wrapped = withValidation(registry, handler);
    const result = await wrapped({ name: "echo", arguments: { text: "hello" } });
    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("blocks invalid inputs and returns LLM-friendly error", async () => {
    const handler = makeHandler("ok");
    const wrapped = withValidation(registry, handler);
    const result = await wrapped({ name: "echo", arguments: { text: 42 } });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("failed input validation");
    expect(handler).not.toHaveBeenCalled();
  });

  it("blocks unregistered tools in strict mode", async () => {
    const handler = makeHandler("ok");
    const wrapped = withValidation(registry, handler);
    const result = await wrapped({ name: "unknown_tool", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("No schema registered");
  });

  it("validates output and blocks invalid response", async () => {
    const badHandler = makeHandler(JSON.stringify({ results: "not-an-array", total: 0 }));
    const wrapped = withValidation(registry, badHandler);
    const result = await wrapped({ name: "search", arguments: { query: "test", limit: 10 } });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("failed output validation");
  });

  it("passes when output matches schema", async () => {
    const wrapped = withValidation(registry, okHandler);
    const result = await wrapped({ name: "search", arguments: { query: "test", limit: 5 } });
    expect(result.isError).toBeUndefined();
  });

  it("calls onValidationError callback on failure", async () => {
    const onValidationError = vi.fn();
    const wrapped = withValidation(registry, makeHandler("ok"), { onValidationError });
    await wrapped({ name: "echo", arguments: { text: 123 } });
    expect(onValidationError).toHaveBeenCalledWith("echo", "input", expect.any(Array));
  });
});

describe("withValidation — soft mode", () => {
  it("logs violations but still calls handler", async () => {
    const handler = makeHandler("ok");
    const logger = { warn: vi.fn(), error: vi.fn() };
    const wrapped = withValidation(registry, handler, { mode: "soft", logger });
    const result = await wrapped({ name: "echo", arguments: { text: 999 } });
    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("allows unregistered tools through in soft mode", async () => {
    const handler = makeHandler("ok");
    const wrapped = withValidation(registry, handler, { mode: "soft" });
    const result = await wrapped({ name: "phantom_tool", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalled();
  });
});

// ─── SchemaRegistryBuilder ────────────────────────────────────────────────────

describe("createRegistry", () => {
  it("registers and retrieves tools", () => {
    const reg = createRegistry()
      .register("ping", { input: z.object({ id: z.string() }) })
      .build();
    expect(reg.ping).toBeDefined();
    expect(reg.ping.input).toBeDefined();
  });

  it("merges two registries", () => {
    const a = createRegistry().register("a", { input: z.object({ x: z.string() }) });
    const b = createRegistry().register("b", { input: z.object({ y: z.number() }) });
    const merged = a.merge(b).build();
    expect(merged.a).toBeDefined();
    expect(merged.b).toBeDefined();
  });

  it("reports tool names", () => {
    const reg = createRegistry()
      .register("foo", {})
      .register("bar", {});
    expect(reg.toolNames()).toEqual(expect.arrayContaining(["foo", "bar"]));
  });
});

// ─── Middleware composition ───────────────────────────────────────────────────

describe("compose", () => {
  it("chains middleware left-to-right", async () => {
    const order: number[] = [];
    const a: typeof compose extends (...args: any[]) => infer R ? R : never = (next) => async (req) => {
      order.push(1);
      const r = await next(req);
      order.push(4);
      return r;
    };
    const b = (next: any) => async (req: any) => {
      order.push(2);
      const r = await next(req);
      order.push(3);
      return r;
    };
    const handler = makeHandler("ok");
    const wrapped = compose(a as any, b as any)(handler);
    await wrapped({ name: "test" });
    expect(order).toEqual([1, 2, 3, 4]);
  });
});

describe("withRateLimit", () => {
  it("allows requests under the limit", async () => {
    const handler = makeHandler("ok");
    const wrapped = withRateLimit({ maxRpm: 5 })(handler);
    const result = await wrapped({ name: "ping" });
    expect(result.isError).toBeUndefined();
  });

  it("blocks requests over the limit", async () => {
    const handler = makeHandler("ok");
    const wrapped = withRateLimit({ maxRpm: 2 })(handler);
    await wrapped({ name: "ping" });
    await wrapped({ name: "ping" });
    const result = await wrapped({ name: "ping" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Rate limit exceeded");
  });
});

describe("withAuditLog", () => {
  it("records calls", async () => {
    const records: any[] = [];
    const handler = makeHandler("ok");
    const wrapped = withAuditLog({ onRecord: (r) => records.push(r) })(handler);
    await wrapped({ name: "test" });
    expect(records).toHaveLength(1);
    expect(records[0].toolName).toBe("test");
    expect(records[0].isError).toBe(false);
  });
});
