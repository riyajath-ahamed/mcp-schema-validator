/**
 * SchemaRegistry — type-safe central store for per-tool schemas.
 * Supports schema inference from TypeScript types.
 */

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { AnyStandardSchema, SchemaRegistry, ToolSchema } from "./validator";

// ─── Infer input/output types from registered schemas ────────────────────────

type InferInput<S> = S extends StandardSchemaV1<infer I, unknown> ? I : never;
type InferOutput<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never;

type InferredToolTypes<R extends SchemaRegistry> = {
  [K in keyof R]: {
    input: R[K]["input"] extends AnyStandardSchema
      ? InferInput<R[K]["input"]>
      : Record<string, unknown>;
    output: R[K]["output"] extends AnyStandardSchema
      ? InferOutput<R[K]["output"]>
      : unknown;
  };
};

// ─── Registry builder ─────────────────────────────────────────────────────────

export class SchemaRegistryBuilder<R extends SchemaRegistry = SchemaRegistry> {
  private _registry: R;

  constructor(initial: R = {} as R) {
    this._registry = initial;
  }

  /**
   * Register a schema for a tool.
   * Returns a new builder with the updated registry type — fully type-safe.
   *
   * @example
   * ```ts
   * const registry = new SchemaRegistryBuilder()
   *   .register("search", {
   *     input:  z.object({ query: z.string() }),
   *     output: z.object({ results: z.array(z.string()) }),
   *   })
   *   .build();
   * ```
   */
  register<N extends string, S extends ToolSchema>(
    toolName: N,
    schema: S
  ): SchemaRegistryBuilder<R & Record<N, S>> {
    return new SchemaRegistryBuilder({
      ...this._registry,
      [toolName]: schema,
    } as R & Record<N, S>);
  }

  /** Finalise and return the plain registry object. */
  build(): R {
    return this._registry;
  }

  /**
   * Return the registry with full type inference.
   * Use this when you need `input` / `output` types on individual tools.
   */
  typed(): InferredToolTypes<R> {
    return this._registry as unknown as InferredToolTypes<R>;
  }

  /** List all registered tool names. */
  toolNames(): Array<keyof R> {
    return Object.keys(this._registry) as Array<keyof R>;
  }

  /** Check if a schema exists for a tool. */
  has(toolName: string): boolean {
    return toolName in this._registry;
  }

  /** Merge another registry into this one (last-write-wins). */
  merge<R2 extends SchemaRegistry>(
    other: SchemaRegistryBuilder<R2>
  ): SchemaRegistryBuilder<R & R2> {
    return new SchemaRegistryBuilder({
      ...this._registry,
      ...other.build(),
    } as R & R2);
  }
}

/**
 * Convenience factory — identical to `new SchemaRegistryBuilder()`.
 *
 * @example
 * ```ts
 * const registry = createRegistry()
 *   .register("echo", { input: z.object({ text: z.string() }) })
 *   .build();
 * ```
 */
export function createRegistry(): SchemaRegistryBuilder {
  return new SchemaRegistryBuilder();
}
