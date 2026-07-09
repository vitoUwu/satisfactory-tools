/**
 * Shared Planner state exposed to every canvas component: the loaded Game Dataset,
 * the live {@link PlanGraph}, the latest {@link FlowResult} (or the reason it could
 * not be computed), the selection, and the reducer `dispatch`. Nodes and edges read
 * this via {@link usePlanner} instead of threading props through React Flow `data`.
 */

import type { DatasetIndex } from "@satisfactory-tools/game-data";
import type {
  Bottleneck,
  FlowResult,
  PlanGraph,
  RecipePreferences,
} from "@satisfactory-tools/planner-engine";
import { createContext, useContext } from "react";

import type { GraphAction } from "./graph-actions";

export interface PlannerContextValue {
  dataset: DatasetIndex;
  graph: PlanGraph;
  dispatch: (action: GraphAction) => void;
  /** Latest steady-state result, or null when it could not be computed yet. */
  flow: FlowResult | null;
  /** Human-readable reason flow is unavailable (e.g. solver not implemented). */
  flowError: string | null;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  /** Node ids highlighted because a hovered bottleneck implicates them. */
  highlightedNodeIds: ReadonlySet<string>;
  setHoveredBottleneck: (b: Bottleneck | null) => void;
  /**
   * Node ids whose recipe/building/item/resource is missing from the pinned Game
   * Dataset (ADR-0002) — flagged as broken until the user fixes or migrates them.
   */
  brokenNodeIds: ReadonlySet<string>;
  /** The Plan's Recipe Preferences, consulted by the Solver Assist. */
  recipePreferences: RecipePreferences;
  /** Update the Plan's Recipe Preferences (persisted on the next autosave). */
  setRecipePreferences: (next: RecipePreferences) => void;
  /**
   * Solver Assist: expand the given Machine node's unmet ingredient chain into new
   * nodes/edges, auto-laid-out to the left of the node. Returns the number of nodes
   * added (0 when there was nothing to expand).
   */
  expandInputs: (nodeId: string) => Promise<number>;
}

export const PlannerContext = createContext<PlannerContextValue | null>(null);

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext);
  if (!ctx) {
    throw new Error("usePlanner must be used within a PlannerContext.Provider");
  }
  return ctx;
}
