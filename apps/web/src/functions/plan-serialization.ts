/**
 * Zod schemas and pure (de)serialization helpers for a {@link PlanGraph} and its
 * {@link RecipePreferences} (see CONTEXT.md, ADR-0004).
 *
 * A Plan's `graph` column is stored as JSON text of the planner-engine contract.
 * These schemas validate untrusted input crossing the server-function boundary
 * and give us a canonical, tested round-trip (object → JSON text → object).
 */

import type {
  PlanEdge,
  PlanGraph,
  PlanNode,
  RecipePreferences,
} from "@satisfactory-tools/planner-engine";
import { PLAN_GRAPH_SCHEMA_VERSION } from "@satisfactory-tools/planner-engine";
import { z } from "zod";

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const puritySchema = z.enum(["impure", "normal", "pure"]);

/** Miner Mk variant (1–3). */
const minerMkSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** Belt Mk (1–6) or Pipe Mk (1–2) — the widest connection Mk range. */
const connectionMkSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

/** Clock Speed is a percentage, 1–250 (CONTEXT.md). */
const clockSpeedSchema = z.number().min(1).max(250);

const machineNodeSchema = z.object({
  kind: z.literal("machine"),
  id: z.string(),
  position: positionSchema,
  buildingClass: z.string(),
  recipeClass: z.string().optional(),
  clockSpeed: clockSpeedSchema,
  somersloops: z.number().int().min(0),
});

const extractorNodeSchema = z.object({
  kind: z.literal("extractor"),
  id: z.string(),
  position: positionSchema,
  buildingClass: z.string(),
  resourceClass: z.string(),
  mk: minerMkSchema.optional(),
  clockSpeed: clockSpeedSchema,
  purity: puritySchema,
});

const splitterNodeSchema = z.object({
  kind: z.literal("splitter"),
  id: z.string(),
  position: positionSchema,
  buildingClass: z.string(),
});

const mergerNodeSchema = z.object({
  kind: z.literal("merger"),
  id: z.string(),
  position: positionSchema,
  buildingClass: z.string(),
});

const planInputNodeSchema = z.object({
  kind: z.literal("planInput"),
  id: z.string(),
  position: positionSchema,
  itemClass: z.string(),
  ratePerMinute: z.number(),
});

const planOutputNodeSchema = z.object({
  kind: z.literal("planOutput"),
  id: z.string(),
  position: positionSchema,
  itemClass: z.string(),
  ratePerMinute: z.number(),
});

const planNodeSchema = z.discriminatedUnion("kind", [
  machineNodeSchema,
  extractorNodeSchema,
  splitterNodeSchema,
  mergerNodeSchema,
  planInputNodeSchema,
  planOutputNodeSchema,
]);

const planEdgeSchema = z.object({
  id: z.string(),
  kind: z.enum(["belt", "pipe"]),
  mk: connectionMkSchema,
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
  targetHandle: z.string(),
});

/** Zod schema for a full {@link PlanGraph}. */
export const planGraphSchema = z.object({
  schemaVersion: z.number().int(),
  nodes: z.array(planNodeSchema),
  edges: z.array(planEdgeSchema),
});

/** Zod schema for {@link RecipePreferences} (item className → recipe className). */
export const recipePreferencesSchema: z.ZodType<RecipePreferences> = z.record(
  z.string(),
  z.string(),
);

// Compile-time guarantee that the schemas stay in lock-step with the contracts.
type _NodeOk = z.infer<typeof planNodeSchema> extends PlanNode ? true : never;
type _EdgeOk = z.infer<typeof planEdgeSchema> extends PlanEdge ? true : never;
type _GraphOk = z.infer<typeof planGraphSchema> extends PlanGraph ? true : never;
const _checks: [_NodeOk, _EdgeOk, _GraphOk] = [true, true, true];
void _checks;

/** An empty PlanGraph stamped with the current schema version. */
export function emptyPlanGraph(): PlanGraph {
  return {
    schemaVersion: PLAN_GRAPH_SCHEMA_VERSION,
    nodes: [],
    edges: [],
  };
}

/** Validate + serialize a PlanGraph to JSON text (as stored in `plans.graph`). */
export function serializePlanGraph(graph: PlanGraph): string {
  return JSON.stringify(planGraphSchema.parse(graph));
}

/** Parse + validate JSON text back into a PlanGraph. */
export function deserializePlanGraph(text: string): PlanGraph {
  return planGraphSchema.parse(JSON.parse(text));
}

/** Validate + serialize RecipePreferences to JSON text. */
export function serializeRecipePreferences(prefs: RecipePreferences): string {
  return JSON.stringify(recipePreferencesSchema.parse(prefs));
}

/** Parse + validate JSON text back into RecipePreferences. */
export function deserializeRecipePreferences(text: string): RecipePreferences {
  return recipePreferencesSchema.parse(JSON.parse(text));
}
