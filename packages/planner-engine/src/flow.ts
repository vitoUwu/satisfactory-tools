/**
 * Steady-state flow results (ADR-0004). {@link computeFlows} solves the fixed-point
 * equilibrium of a {@link PlanGraph} against a {@link DatasetIndex}: each Machine runs
 * at the Efficiency its inputs can sustain and its outputs can drain (back-pressure
 * included), Splitters redistribute overflow, and Belts/Pipes enforce capacity.
 *
 * This module defines the result contract and a typed stub. The solver itself is
 * implemented by another agent.
 */

import type { DatasetIndex } from "@satisfactory-tools/game-data";

import type { PlanGraph } from "./graph";
import { solveFlows } from "./solver";

/** An item throughput: className + rate per minute (items or m³/min). */
export interface ItemRate {
  itemClass: string;
  ratePerMinute: number;
}

/** Computed steady-state result for a single node. */
export interface NodeFlow {
  nodeId: string;
  /** Steady-state Efficiency as a percentage, 0–100 (clock-adjusted nominal = 100). */
  efficiency: number;
  /** Actual per-item consumption at steady state. */
  actualInputs: ItemRate[];
  /** Actual per-item production at steady state. */
  actualOutputs: ItemRate[];
  /**
   * Net power in MW contributed by this node: positive for Generators (produced),
   * negative for consumers (drawn), clock- and Somersloop-adjusted.
   */
  powerMW: number;
}

/** Computed steady-state result for a single edge. */
export interface EdgeFlow {
  edgeId: string;
  /** className of the {@link Item} flowing on this connection. */
  itemClass: string;
  /** Actual throughput at steady state (items or m³/min). */
  actualRatePerMinute: number;
  /** The connection's Mk capacity (items or m³/min). */
  capacityPerMinute: number;
  /** True when `actualRatePerMinute` exceeds `capacityPerMinute`. */
  overCapacity: boolean;
}

/** Plan-wide aggregates. */
export interface PlanTotals {
  /** Power produced by Generators minus power drawn by all other Machines (MW). */
  powerBalanceMW: number;
  /** Raw resources entering the Plan (Extractors + Plan Inputs), aggregated by item. */
  rawInputs: ItemRate[];
  /** Items leaving the Plan (Plan Outputs), aggregated by item. */
  netOutputs: ItemRate[];
  /**
   * Production draining through unconnected output ports (free sinks): items made
   * but not routed anywhere in the Plan, aggregated by item. Surfacing these keeps
   * an in-progress Plan honest — nothing silently disappears.
   */
  unplannedSurplus: ItemRate[];
}

/** A node or edge whose capacity limit forces Machines below 100% Efficiency. */
export interface Bottleneck {
  /** Set when the bottleneck is a node. */
  nodeId?: string;
  /** Set when the bottleneck is an edge. */
  edgeId?: string;
  /** Human-readable explanation. */
  reason: string;
}

/** What kind of dataset reference failed to resolve. */
export type BrokenReferenceKind =
  | "recipe"
  | "building"
  | "item"
  | "resource";

/** A node referencing a recipe/building/item/resource missing from the dataset. */
export interface BrokenReference {
  nodeId: string;
  kind: BrokenReferenceKind;
  /** The unresolved className. */
  reference: string;
  message: string;
}

/** Non-fatal findings surfaced to the user. */
export interface Diagnostics {
  bottlenecks: Bottleneck[];
  brokenReferences: BrokenReference[];
}

/** Full result of a flow computation over a Plan. */
export interface FlowResult {
  /** Per-node results, keyed by node id. */
  perNode: Record<string, NodeFlow>;
  /** Per-edge results, keyed by edge id. */
  perEdge: Record<string, EdgeFlow>;
  totals: PlanTotals;
  diagnostics: Diagnostics;
}

/**
 * Compute steady-state flows, efficiencies, power, and diagnostics for a Plan.
 *
 * @param graph   The Plan graph to solve.
 * @param dataset The pinned Game Dataset to compute against (ADR-0002).
 * @returns A {@link FlowResult}.
 */
export function computeFlows(
  graph: PlanGraph,
  dataset: DatasetIndex,
): FlowResult {
  return solveFlows(graph, dataset);
}
