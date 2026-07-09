/**
 * TanStack Start server functions for Plan persistence (see CONTEXT.md).
 *
 * A Plan is a named, saved factory graph: create / rename / duplicate / delete,
 * plus `savePlanGraph` for client-debounced autosave. Every Plan pins the Game
 * Dataset version it was built against (ADR-0002); that version is set at
 * creation and never changed here (Plan Migration is a separate, explicit act).
 *
 * The `graph` and `recipePreferences` columns use Drizzle's JSON mode, so the
 * planner-engine objects are stored as JSON text and read back typed. Inputs
 * crossing the network are validated with the zod schemas in
 * `./plan-serialization`.
 */

import { randomUUID } from "node:crypto";

import { db } from "@satisfactory-tools/db";
import type { Plan } from "@satisfactory-tools/db/schema/index";
import { plans } from "@satisfactory-tools/db/schema/index";
import { createServerFn } from "@tanstack/react-start";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  emptyPlanGraph,
  planGraphSchema,
  recipePreferencesSchema,
} from "./plan-serialization";

const idInput = z.object({ id: z.string().min(1) });

/** Fetch a Plan row by id or throw a not-found error. */
async function requirePlan(id: string): Promise<Plan> {
  const [row] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  if (!row) {
    throw new Error(`Plan not found: ${id}`);
  }
  return row;
}

/** All Plans, most-recently-updated first. */
export const listPlans = createServerFn({ method: "GET" }).handler(
  async (): Promise<Plan[]> => {
    return db.select().from(plans).orderBy(desc(plans.updatedAt));
  },
);

/** A single Plan by id. */
export const getPlan = createServerFn({ method: "GET" })
  .validator(idInput)
  .handler(async ({ data }): Promise<Plan> => {
    return requirePlan(data.id);
  });

/** Create a new, empty Plan pinned to the given Game Dataset version (ADR-0002). */
export const createPlan = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().min(1).max(200),
      datasetVersion: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<Plan> => {
    const [row] = await db
      .insert(plans)
      .values({
        id: randomUUID(),
        name: data.name,
        datasetVersion: data.datasetVersion,
        graph: emptyPlanGraph(),
        recipePreferences: {},
      })
      .returning();
    // `returning()` on a single insert always yields exactly one row.
    return row as Plan;
  });

/** Rename a Plan. */
export const renamePlan = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }): Promise<Plan> => {
    const [row] = await db
      .update(plans)
      .set({ name: data.name, updatedAt: new Date() })
      .where(eq(plans.id, data.id))
      .returning();
    if (!row) {
      throw new Error(`Plan not found: ${data.id}`);
    }
    return row;
  });

/** Duplicate a Plan, copying its graph, Recipe Preferences and pinned dataset version. */
export const duplicatePlan = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(async ({ data }): Promise<Plan> => {
    const source = await requirePlan(data.id);
    const [row] = await db
      .insert(plans)
      .values({
        id: randomUUID(),
        name: `${source.name} (copy)`,
        datasetVersion: source.datasetVersion,
        graph: source.graph,
        recipePreferences: source.recipePreferences,
      })
      .returning();
    return row as Plan;
  });

/** Delete a Plan. Returns the deleted id. */
export const deletePlan = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    await db.delete(plans).where(eq(plans.id, data.id));
    return { id: data.id };
  });

/**
 * Persist a Plan's graph and Recipe Preferences (autosave target). The client
 * owns debouncing; this simply writes the latest snapshot and bumps `updatedAt`.
 */
export const savePlanGraph = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().min(1),
      graph: planGraphSchema,
      recipePreferences: recipePreferencesSchema,
    }),
  )
  .handler(async ({ data }): Promise<Plan> => {
    const [row] = await db
      .update(plans)
      .set({
        graph: data.graph,
        recipePreferences: data.recipePreferences,
        updatedAt: new Date(),
      })
      .where(eq(plans.id, data.id))
      .returning();
    if (!row) {
      throw new Error(`Plan not found: ${data.id}`);
    }
    return row;
  });
