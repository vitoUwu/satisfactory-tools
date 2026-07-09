import type {
  PlanGraph,
  RecipePreferences,
} from "@satisfactory-tools/planner-engine";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * A Plan: a named, saved factory graph owned by the user (see CONTEXT.md).
 *
 * Each Plan pins the Game Dataset version it was built against (ADR-0002) and
 * stores its full graph and Recipe Preferences as JSON text. The `graph` and
 * `recipePreferences` columns are typed to the planner-engine contracts via
 * Drizzle's `$type`, so reads/writes are strongly typed end-to-end.
 */
export const plans = sqliteTable("plans", {
  /** uuid primary key. */
  id: text("id").primaryKey(),
  /** User-facing plan name. */
  name: text("name").notNull(),
  /** Pinned Game Dataset version, e.g. "1.2" (ADR-0002). */
  datasetVersion: text("dataset_version").notNull(),
  /** Serialized {@link PlanGraph} (JSON). */
  graph: text("graph", { mode: "json" }).$type<PlanGraph>().notNull(),
  /** Serialized {@link RecipePreferences} (JSON): item className → recipe className. */
  recipePreferences: text("recipe_preferences", { mode: "json" })
    .$type<RecipePreferences>()
    .notNull(),
  /** Row creation time. */
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  /** Last update time. */
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/** Row type for selecting a plan. */
export type Plan = typeof plans.$inferSelect;
/** Row type for inserting a plan. */
export type NewPlan = typeof plans.$inferInsert;
