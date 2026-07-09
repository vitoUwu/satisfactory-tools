/**
 * Plan graph model (ADR-0004). A Plan maps 1:1 to what would be built in-game:
 * Splitters and Mergers are first-class nodes (flow never splits implicitly at a
 * machine port) and every connection is a Belt or Pipe with an Mk variant and an
 * enforced capacity.
 *
 * A {@link PlanGraph} is a plain, JSON-serializable object. It is what gets stored
 * in the `plans.graph` column and rendered by the React Flow canvas (ADR-0003),
 * so node/edge shapes intentionally match React Flow's `{ id, position, data }`
 * and `{ id, source, sourceHandle, target, targetHandle }` conventions.
 */

import type { BeltMk, MinerMk, PipeMk, Purity } from "@satisfactory-tools/game-data";

/** Canvas coordinates for a node. */
export interface Position {
  x: number;
  y: number;
}

/** Discriminant for the {@link PlanNode} union. */
export type PlanNodeKind =
  | "machine"
  | "extractor"
  | "splitter"
  | "merger"
  | "planInput"
  | "planOutput";

interface PlanNodeBase {
  /** Stable per-graph node id (uuid); referenced by edges. */
  id: string;
  position: Position;
}

/**
 * A recipe-running production Machine (Manufacturer or Generator). Generators are
 * Machines whose `recipeClass` is undefined and whose building is a Generator.
 */
export interface MachineNode extends PlanNodeBase {
  kind: "machine";
  /** className of the {@link Building} placed (Manufacturer or Generator). */
  buildingClass: string;
  /** className of the selected {@link Recipe}; undefined for Generators. */
  recipeClass?: string;
  /** Clock speed as a percentage, 1–250. */
  clockSpeed: number;
  /** Number of Somersloops slotted (0..building's slot count). */
  somersloops: number;
}

/** An {@link Extractor} Machine sitting on a resource node. */
export interface ExtractorNode extends PlanNodeBase {
  kind: "extractor";
  /** className of the extractor {@link Building}. */
  buildingClass: string;
  /** className of the raw resource {@link Item} being extracted. */
  resourceClass: string;
  /** Mk variant for Miners (1–3); undefined for Water/Oil extractors. */
  mk?: MinerMk;
  /** Clock speed as a percentage, 1–250. */
  clockSpeed: number;
  /** Purity of the resource node the extractor sits on. */
  purity: Purity;
}

/** A Splitter logistics node (1 input → up to 3 outputs). */
export interface SplitterNode extends PlanNodeBase {
  kind: "splitter";
  /** className of the splitter {@link Building}. */
  buildingClass: string;
}

/** A Merger logistics node (up to 3 inputs → 1 output). */
export interface MergerNode extends PlanNodeBase {
  kind: "merger";
  /** className of the merger {@link Building}. */
  buildingClass: string;
}

/** A boundary node declaring items enter the Plan at a fixed rate. */
export interface PlanInputNode extends PlanNodeBase {
  kind: "planInput";
  /** className of the {@link Item} entering the Plan. */
  itemClass: string;
  /** Declared arrival rate in items (or m³) per minute. */
  ratePerMinute: number;
}

/** A boundary node declaring items leave the Plan at a fixed rate. */
export interface PlanOutputNode extends PlanNodeBase {
  kind: "planOutput";
  /** className of the {@link Item} leaving the Plan. */
  itemClass: string;
  /** Declared demand rate in items (or m³) per minute. */
  ratePerMinute: number;
}

/** All Plan node shapes, discriminated on {@link PlanNodeKind}. */
export type PlanNode =
  | MachineNode
  | ExtractorNode
  | SplitterNode
  | MergerNode
  | PlanInputNode
  | PlanOutputNode;

/** Whether a connection carries solids (Belt) or fluids (Pipe). */
export type EdgeKind = "belt" | "pipe";

/**
 * A Belt or Pipe connecting one node's output port to another node's input port.
 * `mk` is a {@link BeltMk} for belts and a {@link PipeMk} for pipes; it sets the
 * connection's capacity (see the game-data capacity tables).
 */
export interface PlanEdge {
  /** Stable per-graph edge id (uuid). */
  id: string;
  kind: EdgeKind;
  /** Mk variant: BeltMk (1–6) for belts, PipeMk (1–2) for pipes. */
  mk: BeltMk | PipeMk;
  /** Source node id. */
  source: string;
  /** Named output port on the source node (e.g. "out", "out0".."out2"). */
  sourceHandle: string;
  /** Target node id. */
  target: string;
  /** Named input port on the target node (e.g. "in", "in0".."in2"). */
  targetHandle: string;
}

/** Current schema version of the serialized PlanGraph; bump on breaking shape changes. */
export const PLAN_GRAPH_SCHEMA_VERSION = 1;

/** The full, JSON-serializable Plan graph stored in `plans.graph`. */
export interface PlanGraph {
  /** {@link PLAN_GRAPH_SCHEMA_VERSION} at save time. */
  schemaVersion: number;
  nodes: PlanNode[];
  edges: PlanEdge[];
}

/**
 * A Plan's Recipe Preferences: item className → chosen recipe className. Consulted
 * by the Solver Assist; defaults to each item's standard (non-alternate) recipe.
 * Stored in the `plans.recipePreferences` column.
 */
export type RecipePreferences = Record<string, string>;
