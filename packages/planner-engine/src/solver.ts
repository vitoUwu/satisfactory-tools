/**
 * Steady-state flow solver (ADR-0004). Implements {@link solveFlows}, the engine
 * behind {@link computeFlows}. It is pure TypeScript — no DOM/React — and solves the
 * fixed-point equilibrium of a physical Plan graph with back-pressure.
 *
 * ## Model
 *
 * Each production node runs at an Efficiency in [0,1] which is the minimum of two
 * independent constraints:
 *   - `inEff`  — how much of its nominal input its upstream can actually supply.
 *   - `outEff` — how much of its nominal output its downstream can actually drain
 *                (this is the back-pressure term).
 * Its steady-state Efficiency is `min(inEff, outEff)`.
 *
 * These two constraints propagate along two independent directional chains:
 *   - The *supply chain* (`supplyCap`, `inEff`) flows strictly downstream from
 *     Extractors / Plan Inputs: how much each edge's source can push.
 *   - The *demand chain* (`demandCap`, `outEff`) flows strictly upstream from Plan
 *     Outputs / drains: how much each edge's target can pull.
 * The realized flow on an edge is `min(supplyCap, demandCap, beltCapacity)`.
 *
 * ## Free sinks (unconnected output ports)
 *
 * Back-pressure only applies on CONNECTED paths. An output port with nothing
 * attached drains freely: an output item with no edges never gates `outEff`, a
 * Splitter with a spare port (or a Merger with no output) pulls at full connection
 * capacity, and whatever drains this way is reported as unplanned surplus in the
 * totals. This keeps an in-progress Plan live while it is being built instead of
 * stalling every chain whose final output is not routed yet.
 *
 * For an acyclic graph both chains resolve exactly in a single recursive pass. For
 * graphs with cycles (recycled water / plastic loops) a recursion re-entry is broken
 * by returning the previous outer-iteration value; the outer loop then relaxes to a
 * fixed point (epsilon 1e-6, iteration cap 500). Loops of this kind are monotone, so
 * they converge without oscillation; light damping guards pathological cases.
 *
 * ## Splitters / Mergers
 *
 * Splitters split their available input evenly across connected outputs, with
 * overflow from saturated branches redistributed to the remaining ones (matching the
 * in-game round-robin steady state) — see {@link distributeEven}. Mergers sum their
 * inputs into one output and, under back-pressure, distribute the permitted pull back
 * across inputs by available supply.
 *
 * ## Power (documented game assumptions)
 *
 * - Clock speed scales a Machine's rates linearly and its power by
 *   `basePower * (clock/100)^exponent` (exponent ~1.321928, carried per-building).
 * - Somersloops: output multiplier `1 + slotted/maxSlots`; power multiplier is the
 *   square of that output multiplier.
 * - A Machine below 100% Efficiency still draws its FULL power. The game only stops
 *   drawing power when a Machine is fully idle (produces nothing); a partially-fed
 *   Machine is not idle, so we bill it at full power. This is intentional.
 * - Generators produce `powerProduction * (clock/100) * efficiency`, where efficiency
 *   is their fuel (and byproduct-drain) satisfaction, and consume fuel via item flow.
 */

import {
  isGenerator,
  isManufacturer,
  PURITY_MULTIPLIER,
} from "@satisfactory-tools/game-data";
import type {
  BeltMk,
  Building,
  DatasetIndex,
  PipeMk,
  Purity,
} from "@satisfactory-tools/game-data";

import type { PlanEdge, PlanGraph, PlanNode } from "./graph";
import type {
  Bottleneck,
  BrokenReference,
  Diagnostics,
  EdgeFlow,
  FlowResult,
  ItemRate,
  NodeFlow,
  PlanTotals,
} from "./flow";

const EPSILON = 1e-6;
const MAX_ITER = 500;
/** Damping applied to the loop-carried (cycle-fallback) values each iteration. */
const ALPHA = 0.5;
/** Power-curve exponent used when a building omits its own. */
const DEFAULT_POWER_EXPONENT = 1.321928;
/** A Splitter has this many output ports; fewer connected edges means a free port. */
const SPLITTER_OUT_PORTS = 3;

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function lerp(prev: number, next: number, alpha: number): number {
  return prev + alpha * (next - prev);
}

/**
 * Distribute `total` across branches whose per-branch acceptance is `caps`, evenly,
 * redistributing the overflow from any branch that saturates onto the branches that
 * still have room (the game's splitter behavior). Returns the per-branch allocation.
 */
export function distributeEven(total: number, caps: number[]): number[] {
  const n = caps.length;
  const alloc = new Array<number>(n).fill(0);
  if (n === 0 || total <= EPSILON) return alloc;
  let remaining = total;
  const active = new Set<number>();
  for (let i = 0; i < n; i++) {
    if ((caps[i] ?? 0) > EPSILON) active.add(i);
  }
  let guard = 0;
  while (remaining > EPSILON && active.size > 0 && guard++ < 2000) {
    const share = remaining / active.size;
    let progressed = false;
    for (const i of Array.from(active)) {
      const cap = caps[i] ?? 0;
      const room = cap - (alloc[i] ?? 0);
      const give = Math.min(share, room);
      if (give > EPSILON) {
        alloc[i] = (alloc[i] ?? 0) + give;
        remaining -= give;
        progressed = true;
      }
      if ((alloc[i] ?? 0) >= cap - EPSILON) active.delete(i);
    }
    if (!progressed) break;
  }
  return alloc;
}

// ---------------------------------------------------------------------------
// Static per-node model
// ---------------------------------------------------------------------------

type NodeKind = PlanNode["kind"];

interface NodeRec {
  id: string;
  kind: NodeKind;
  node: PlanNode;
  /** Nominal (clock/somersloop-adjusted) production per item at 100% Efficiency. */
  nominalOut: Map<string, number>;
  /** Nominal consumption per item at 100% Efficiency. */
  nominalIn: Map<string, number>;
  inEdges: string[];
  outEdges: string[];
  inByItem: Map<string, string[]>;
  outByItem: Map<string, string[]>;
  /** Static power (MW). Negative = drawn. Generators computed after solve. */
  staticPowerMW: number;
  isGenerator: boolean;
  /** Generator power production at 100% clock (scaled by clock*eff at report time). */
  generatorProductionMW: number;
  generatorClockFrac: number;
  /** A generator with no fuel connected produces nothing (never "free" power). */
  generatorHasFuel: boolean;
  broken: boolean;
}

const MK_BELT: BeltMk[] = [1, 2, 3, 4, 5, 6];
const MK_PIPE: PipeMk[] = [1, 2];

function isBeltMk(mk: number): mk is BeltMk {
  return (MK_BELT as number[]).includes(mk);
}
function isPipeMk(mk: number): mk is PipeMk {
  return (MK_PIPE as number[]).includes(mk);
}

function edgeCapacity(edge: PlanEdge, dataset: DatasetIndex): number {
  if (edge.kind === "belt") {
    const mk = isBeltMk(edge.mk) ? edge.mk : 1;
    return dataset.beltCapacity[mk];
  }
  const mk = isPipeMk(edge.mk) ? edge.mk : 1;
  return dataset.pipeCapacity[mk];
}

/** Output item candidates for a node; `null` means "passthrough logistics". */
function nodeOutItems(node: PlanNode, dataset: DatasetIndex): string[] | null {
  switch (node.kind) {
    case "extractor":
      return [node.resourceClass];
    case "planInput":
      return [node.itemClass];
    case "planOutput":
      return [];
    case "splitter":
    case "merger":
      return null;
    case "machine": {
      const building = dataset.buildings[node.buildingClass];
      if (building && isGenerator(building)) {
        return building.byproduct ? [building.byproduct.item] : [];
      }
      if (node.recipeClass) {
        const recipe = dataset.recipes[node.recipeClass];
        if (recipe) return recipe.products.map((p) => p.item);
      }
      return [];
    }
  }
}

/** Input item candidates for a node; `null` means "passthrough logistics". */
function nodeInItems(node: PlanNode, dataset: DatasetIndex): string[] | null {
  switch (node.kind) {
    case "planOutput":
      return [node.itemClass];
    case "extractor":
    case "planInput":
      return [];
    case "splitter":
    case "merger":
      return null;
    case "machine": {
      const building = dataset.buildings[node.buildingClass];
      if (building && isGenerator(building)) {
        const items = [...building.fuelClasses];
        if (building.supplementalResource) items.push(building.supplementalResource);
        return items;
      }
      if (node.recipeClass) {
        const recipe = dataset.recipes[node.recipeClass];
        if (recipe) return recipe.ingredients.map((i) => i.item);
      }
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

export function solveFlows(graph: PlanGraph, dataset: DatasetIndex): FlowResult {
  const nodeById = new Map<string, PlanNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  const edgeById = new Map<string, PlanEdge>();
  const edgeCap = new Map<string, number>();
  for (const e of graph.edges) {
    edgeById.set(e.id, e);
    edgeCap.set(e.id, edgeCapacity(e, dataset));
  }

  const brokenReferences = collectBrokenReferences(graph, dataset);
  const brokenNodeIds = new Set(brokenReferences.map((b) => b.nodeId));

  // ---- Resolve the item carried by each edge --------------------------------
  const edgeItem = resolveEdgeItems(graph, nodeById, dataset);

  // ---- Build per-node static records ---------------------------------------
  const nodeRec = new Map<string, NodeRec>();
  for (const node of graph.nodes) {
    nodeRec.set(node.id, buildNodeRec(node, dataset, brokenNodeIds.has(node.id)));
  }
  // Wire adjacency + nominal generator inputs (needs resolved edge items).
  for (const e of graph.edges) {
    const item = edgeItem.get(e.id);
    const src = nodeRec.get(e.source);
    const tgt = nodeRec.get(e.target);
    if (src) {
      src.outEdges.push(e.id);
      if (item) push(src.outByItem, item, e.id);
    }
    if (tgt) {
      tgt.inEdges.push(e.id);
      if (item) push(tgt.inByItem, item, e.id);
    }
  }
  // Extractors clamp their nominal output to the belt capacity of their outputs.
  for (const rec of nodeRec.values()) {
    if (rec.node.kind === "extractor" && rec.outEdges.length > 0) {
      const beltSum = rec.outEdges.reduce((s, id) => s + (edgeCap.get(id) ?? 0), 0);
      for (const [item, rate] of rec.nominalOut) {
        rec.nominalOut.set(item, Math.min(rate, beltSum));
      }
    }
  }
  // Generators: derive nominal fuel/supplemental consumption from the fuel item(s)
  // actually connected to their inputs.
  for (const rec of nodeRec.values()) {
    if (!rec.isGenerator || rec.broken) continue;
    const building = dataset.buildings[(rec.node as { buildingClass: string }).buildingClass];
    if (!building || !isGenerator(building)) continue;
    const clockFrac = rec.generatorClockFrac;
    const connectedItems = new Set<string>();
    for (const ie of rec.inEdges) {
      const it = edgeItem.get(ie);
      if (it) connectedItems.add(it);
    }
    for (const fuel of building.fuelClasses) {
      if (!connectedItems.has(fuel)) continue;
      const item = dataset.items[fuel];
      if (!item?.energyMJ) continue;
      // items/min = 60 * MW / MJ-per-item, scaled by clock.
      const rate = (60 * building.powerProductionMW * clockFrac) / item.energyMJ;
      rec.nominalIn.set(fuel, rate);
      rec.generatorHasFuel = true;
      break; // one fuel type at a time
    }
    if (building.supplementalResource && building.supplementalRatePerMinute) {
      rec.nominalIn.set(
        building.supplementalResource,
        building.supplementalRatePerMinute * clockFrac,
      );
    }
    if (building.byproduct) {
      rec.nominalOut.set(building.byproduct.item, building.byproduct.ratePerMinute * clockFrac);
    }
  }

  // ---- Fixed-point iteration -----------------------------------------------
  // Cycle-carried fallbacks bracket the fixed point from opposite sides so a
  // recycled loop relaxes to its true value instead of sticking at a degenerate
  // zero: the supply chain starts pessimistic (0) and ramps up, the demand chain
  // starts optimistic (full capacity) and ramps down.
  const prevSupply = new Map<string, number>();
  const prevDemand = new Map<string, number>();
  const prevInEff = new Map<string, number>();
  const prevOutEff = new Map<string, number>();
  let prevFlow = new Map<string, number>();
  for (const e of graph.edges) prevDemand.set(e.id, edgeCap.get(e.id) ?? 0);
  for (const rec of nodeRec.values()) prevOutEff.set(rec.id, 1);

  // Per-iteration memo/stacks (rebound each pass).
  let supMemo = new Map<string, number>();
  let demMemo = new Map<string, number>();
  let inEffMemo = new Map<string, number>();
  let outEffMemo = new Map<string, number>();
  let supStack = new Set<string>();
  let demStack = new Set<string>();
  let inEffStack = new Set<string>();
  let outEffStack = new Set<string>();

  function inEff(id: string): number {
    const m = inEffMemo.get(id);
    if (m !== undefined) return m;
    if (inEffStack.has(id)) return prevInEff.get(id) ?? 0;
    inEffStack.add(id);
    const rec = nodeRec.get(id);
    let e = 1;
    if (rec && !rec.broken && rec.isGenerator && !rec.generatorHasFuel) {
      // A generator with no fuel item connected converts nothing — no free power.
      e = 0;
    } else if (rec && !rec.broken && rec.nominalIn.size > 0) {
      e = Infinity;
      for (const [item, need] of rec.nominalIn) {
        if (need <= EPSILON) continue;
        let supply = 0;
        for (const ie of rec.inByItem.get(item) ?? []) {
          supply += Math.min(supplyCap(ie), edgeCap.get(ie) ?? 0);
        }
        e = Math.min(e, supply / need);
      }
      if (!Number.isFinite(e)) e = 1;
    }
    e = clamp01(e);
    inEffStack.delete(id);
    inEffMemo.set(id, e);
    return e;
  }

  function outEff(id: string): number {
    const m = outEffMemo.get(id);
    if (m !== undefined) return m;
    if (outEffStack.has(id)) return prevOutEff.get(id) ?? 1;
    outEffStack.add(id);
    const rec = nodeRec.get(id);
    let e = 1;
    if (rec && !rec.broken && rec.nominalOut.size > 0) {
      e = Infinity;
      for (const [item, made] of rec.nominalOut) {
        if (made <= EPSILON) continue;
        // A recycled item the machine also consumes (net consumer of it) has its
        // drainage self-guaranteed by its own consumption, so it must not gate
        // outEff — otherwise a fluid recycle loop is left mathematically
        // underdetermined and settles below its true equilibrium.
        if ((rec.nominalIn.get(item) ?? 0) >= made) continue;
        // Free sink: an output item with no connected edge drains freely and must
        // not gate outEff — it is reported as unplanned surplus instead.
        if ((rec.outByItem.get(item) ?? []).length === 0) continue;
        let drain = 0;
        for (const oe of rec.outByItem.get(item) ?? []) {
          drain += Math.min(demandCap(oe), edgeCap.get(oe) ?? 0);
        }
        e = Math.min(e, drain / made);
      }
      if (!Number.isFinite(e)) e = 1;
    }
    e = clamp01(e);
    outEffStack.delete(id);
    outEffMemo.set(id, e);
    return e;
  }

  function supplyCap(edgeId: string): number {
    const m = supMemo.get(edgeId);
    if (m !== undefined) return m;
    if (supStack.has(edgeId)) return prevSupply.get(edgeId) ?? 0;
    supStack.add(edgeId);
    const e = edgeById.get(edgeId);
    const item = edgeItem.get(edgeId);
    let result = 0;
    if (e && item) {
      const src = nodeRec.get(e.source);
      if (src && !src.broken) {
        if (src.kind === "splitter") {
          let total = 0;
          for (const ie of src.inEdges) {
            total += Math.min(supplyCap(ie), edgeCap.get(ie) ?? 0);
          }
          const outs = src.outEdges;
          const caps = outs.map((o) => Math.min(edgeCap.get(o) ?? 0, demandCap(o)));
          const alloc = distributeEven(total, caps);
          outs.forEach((o, i) => supMemo.set(o, alloc[i] ?? 0));
          result = supMemo.get(edgeId) ?? 0;
        } else if (src.kind === "merger") {
          let total = 0;
          for (const ie of src.inEdges) {
            total += Math.min(supplyCap(ie), edgeCap.get(ie) ?? 0);
          }
          const outs = src.outEdges;
          const alloc = distributeEven(total, outs.map((o) => edgeCap.get(o) ?? 0));
          outs.forEach((o, i) => supMemo.set(o, alloc[i] ?? 0));
          result = supMemo.get(edgeId) ?? 0;
        } else {
          // producer (machine / extractor / planInput / generator byproduct).
          // Throughput is gated by the machine's coupled Efficiency min(inEff,outEff)
          // so every output port throttles together under back-pressure (mass stays
          // conserved even when only one product is blocked).
          const nominal = src.nominalOut.get(item) ?? 0;
          const eff =
            src.kind === "extractor" || src.kind === "planInput"
              ? 1
              : Math.min(inEff(src.id), outEff(src.id));
          const total = nominal * eff;
          // A producer pushes its full desired output onto its (normally single)
          // output edge; belt capacity is enforced later at flow = min(sup,dem,cap),
          // so that "desired exceeds capacity" is still detectable. Multiple edges of
          // the same item split evenly.
          const group = src.outByItem.get(item) ?? [edgeId];
          const alloc = distributeEven(total, group.map(() => Infinity));
          group.forEach((o, i) => supMemo.set(o, alloc[i] ?? 0));
          result = supMemo.get(edgeId) ?? 0;
        }
      }
    }
    supStack.delete(edgeId);
    if (!supMemo.has(edgeId)) supMemo.set(edgeId, result);
    return supMemo.get(edgeId) ?? 0;
  }

  function demandCap(edgeId: string): number {
    const m = demMemo.get(edgeId);
    if (m !== undefined) return m;
    if (demStack.has(edgeId)) return prevDemand.get(edgeId) ?? (edgeCap.get(edgeId) ?? 0);
    demStack.add(edgeId);
    const e = edgeById.get(edgeId);
    const item = edgeItem.get(edgeId);
    let result = 0;
    if (e && item) {
      const tgt = nodeRec.get(e.target);
      if (tgt && !tgt.broken) {
        if (tgt.kind === "splitter") {
          if (tgt.outEdges.length < SPLITTER_OUT_PORTS) {
            // Free sink: a spare output port drains freely, so the splitter pulls
            // at full connection capacity; connected branches keep priority and
            // only the excess drains away (unplanned surplus).
            for (const i of tgt.inEdges) demMemo.set(i, edgeCap.get(i) ?? 0);
            result = demMemo.get(edgeId) ?? 0;
          } else {
            let total = 0;
            for (const oe of tgt.outEdges) {
              total += Math.min(edgeCap.get(oe) ?? 0, demandCap(oe));
            }
            const ins = tgt.inEdges;
            const alloc = distributeEven(total, ins.map((i) => edgeCap.get(i) ?? 0));
            ins.forEach((i, idx) => demMemo.set(i, alloc[idx] ?? 0));
            result = demMemo.get(edgeId) ?? 0;
          }
        } else if (tgt.kind === "merger") {
          if (tgt.outEdges.length === 0) {
            // Free sink: a merger with its output port unconnected drains freely.
            for (const i of tgt.inEdges) demMemo.set(i, edgeCap.get(i) ?? 0);
            result = demMemo.get(edgeId) ?? 0;
          } else {
            let total = 0;
            for (const oe of tgt.outEdges) {
              total += Math.min(edgeCap.get(oe) ?? 0, demandCap(oe));
            }
            const ins = tgt.inEdges;
            const caps = ins.map((i) => Math.min(edgeCap.get(i) ?? 0, supplyCap(i)));
            const alloc = distributeEven(total, caps);
            ins.forEach((i, idx) => demMemo.set(i, alloc[idx] ?? 0));
            result = demMemo.get(edgeId) ?? 0;
          }
        } else {
          // consumer (machine / generator / planOutput)
          const nominal = tgt.nominalIn.get(item) ?? 0;
          const eff = tgt.kind === "planOutput" ? 1 : outEff(tgt.id);
          const need = nominal * eff;
          // Consumer pulls its full desired input; belt capacity enforced at flow.
          const group = tgt.inByItem.get(item) ?? [edgeId];
          const alloc = distributeEven(need, group.map(() => Infinity));
          group.forEach((i, idx) => demMemo.set(i, alloc[idx] ?? 0));
          result = demMemo.get(edgeId) ?? 0;
        }
      }
    }
    demStack.delete(edgeId);
    if (!demMemo.has(edgeId)) demMemo.set(edgeId, result);
    return demMemo.get(edgeId) ?? 0;
  }

  for (let iter = 0; iter < MAX_ITER; iter++) {
    supMemo = new Map();
    demMemo = new Map();
    inEffMemo = new Map();
    outEffMemo = new Map();
    supStack = new Set();
    demStack = new Set();
    inEffStack = new Set();
    outEffStack = new Set();

    for (const e of graph.edges) {
      supplyCap(e.id);
      demandCap(e.id);
    }
    // Force all node effs into memo for fallback carry-over.
    for (const rec of nodeRec.values()) {
      inEff(rec.id);
      outEff(rec.id);
    }

    const flow = new Map<string, number>();
    let maxDelta = 0;
    for (const e of graph.edges) {
      const sup = supMemo.get(e.id) ?? 0;
      const dem = demMemo.get(e.id) ?? 0;
      const cap = edgeCap.get(e.id) ?? 0;
      const f = Math.min(sup, dem, cap);
      flow.set(e.id, f);
      maxDelta = Math.max(maxDelta, Math.abs(f - (prevFlow.get(e.id) ?? 0)));
    }

    // Damp the loop-carried fallback values.
    for (const e of graph.edges) {
      prevSupply.set(e.id, lerp(prevSupply.get(e.id) ?? 0, supMemo.get(e.id) ?? 0, ALPHA));
      prevDemand.set(e.id, lerp(prevDemand.get(e.id) ?? 0, demMemo.get(e.id) ?? 0, ALPHA));
    }
    for (const rec of nodeRec.values()) {
      prevInEff.set(rec.id, lerp(prevInEff.get(rec.id) ?? 0, inEffMemo.get(rec.id) ?? 0, ALPHA));
      prevOutEff.set(rec.id, lerp(prevOutEff.get(rec.id) ?? 0, outEffMemo.get(rec.id) ?? 0, ALPHA));
    }

    prevFlow = flow;
    if (iter > 0 && maxDelta < EPSILON) break;
  }

  // ---- Assemble the result --------------------------------------------------
  const finalFlow = prevFlow;
  const perNode: Record<string, NodeFlow> = {};
  const perEdge: Record<string, EdgeFlow> = {};

  for (const e of graph.edges) {
    const sup = supMemo.get(e.id) ?? 0;
    const dem = demMemo.get(e.id) ?? 0;
    const cap = edgeCap.get(e.id) ?? 0;
    const desired = Math.min(sup, dem);
    perEdge[e.id] = {
      edgeId: e.id,
      itemClass: edgeItem.get(e.id) ?? "",
      actualRatePerMinute: finalFlow.get(e.id) ?? 0,
      capacityPerMinute: cap,
      overCapacity: desired > cap + EPSILON,
    };
  }

  const surplus = new Map<string, number>();
  for (const rec of nodeRec.values()) {
    const actualInputs = ratesFrom(rec.inByItem, finalFlow);
    const actualOutputs = ratesFrom(rec.outByItem, finalFlow);
    const ie = inEffMemo.get(rec.id) ?? 1;
    const oe = outEffMemo.get(rec.id) ?? 1;
    collectFreeSink(rec, ie, oe, actualInputs, actualOutputs, surplus);
    const eff = machineEfficiency(rec, ie, oe, actualInputs, actualOutputs);
    perNode[rec.id] = {
      nodeId: rec.id,
      efficiency: eff * 100,
      actualInputs,
      actualOutputs,
      powerMW: nodePower(rec, Math.min(ie, oe)),
    };
  }

  const totals = computeTotals(nodeRec, perNode, surplus);
  const diagnostics: Diagnostics = {
    brokenReferences,
    bottlenecks: detectBottlenecks(
      nodeRec,
      perNode,
      perEdge,
      inEffMemo,
      outEffMemo,
      edgeItem,
      dataset,
    ),
  };

  return { perNode, perEdge, totals, diagnostics };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function push(map: Map<string, string[]>, key: string, value: string): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function ratesFrom(
  byItem: Map<string, string[]>,
  flow: Map<string, number>,
): ItemRate[] {
  const out: ItemRate[] = [];
  for (const [item, edges] of byItem) {
    let rate = 0;
    for (const id of edges) rate += flow.get(id) ?? 0;
    out.push({ itemClass: item, ratePerMinute: rate });
  }
  return out;
}

/**
 * Account for production draining through free sinks (unconnected output ports).
 * Producers append the free-sunk rate to their `actualOutputs` (the Machine really
 * is making those items); logistics nodes with a spare port sink whatever enters
 * and does not leave. Both accumulate into the plan-wide unplanned surplus.
 */
function collectFreeSink(
  rec: NodeRec,
  ie: number,
  oe: number,
  actualInputs: ItemRate[],
  actualOutputs: ItemRate[],
  surplus: Map<string, number>,
): void {
  if (rec.broken) return;
  if (rec.kind === "splitter" || rec.kind === "merger") {
    for (const r of actualInputs) {
      const routed =
        actualOutputs.find((o) => o.itemClass === r.itemClass)?.ratePerMinute ?? 0;
      const excess = r.ratePerMinute - routed;
      if (excess > EPSILON) {
        surplus.set(r.itemClass, (surplus.get(r.itemClass) ?? 0) + excess);
      }
    }
    return;
  }
  if (rec.kind === "planOutput") return;
  const runEff = Math.min(ie, oe);
  for (const [item, made] of rec.nominalOut) {
    if (made <= EPSILON) continue;
    if ((rec.outByItem.get(item) ?? []).length > 0) continue;
    const rate = made * runEff;
    if (rate <= EPSILON) continue;
    actualOutputs.push({ itemClass: item, ratePerMinute: rate });
    surplus.set(item, (surplus.get(item) ?? 0) + rate);
  }
}

function machineEfficiency(
  rec: NodeRec,
  ie: number,
  oe: number,
  actualInputs: ItemRate[],
  actualOutputs: ItemRate[],
): number {
  if (rec.broken) return 0;
  switch (rec.kind) {
    case "splitter":
    case "merger":
      return 1;
    case "extractor":
      return oe;
    case "planInput": {
      const nominal = sumValues(rec.nominalOut);
      const actual = actualOutputs.reduce((s, r) => s + r.ratePerMinute, 0);
      return nominal > EPSILON ? clamp01(actual / nominal) : 1;
    }
    case "planOutput": {
      const nominal = sumValues(rec.nominalIn);
      const actual = actualInputs.reduce((s, r) => s + r.ratePerMinute, 0);
      return nominal > EPSILON ? clamp01(actual / nominal) : 1;
    }
    case "machine":
      return Math.min(ie, oe);
  }
}

function sumValues(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

function nodePower(rec: NodeRec, eff: number): number {
  if (rec.broken) return 0;
  if (rec.isGenerator) {
    return rec.generatorProductionMW * rec.generatorClockFrac * eff;
  }
  return rec.staticPowerMW;
}

function buildNodeRec(node: PlanNode, dataset: DatasetIndex, broken: boolean): NodeRec {
  const rec: NodeRec = {
    id: node.id,
    kind: node.kind,
    node,
    nominalOut: new Map(),
    nominalIn: new Map(),
    inEdges: [],
    outEdges: [],
    inByItem: new Map(),
    outByItem: new Map(),
    staticPowerMW: 0,
    isGenerator: false,
    generatorProductionMW: 0,
    generatorClockFrac: 1,
    generatorHasFuel: false,
    broken,
  };
  if (broken) return rec;

  if (node.kind === "machine") {
    const building = dataset.buildings[node.buildingClass];
    const clockFrac = node.clockSpeed / 100;
    if (building && isGenerator(building)) {
      rec.isGenerator = true;
      rec.generatorProductionMW = building.powerProductionMW;
      rec.generatorClockFrac = clockFrac;
      // nominal fuel/supplemental/byproduct filled later (needs edge items).
      return rec;
    }
    if (node.recipeClass) {
      const recipe = dataset.recipes[node.recipeClass];
      if (recipe) {
        const slots =
          building && isManufacturer(building) ? building.somersloopSlots : 0;
        const sloopMult = slots > 0 ? 1 + node.somersloops / slots : 1;
        for (const ing of recipe.ingredients) {
          rec.nominalIn.set(
            ing.item,
            (rec.nominalIn.get(ing.item) ?? 0) + ing.ratePerMinute * clockFrac,
          );
        }
        for (const prod of recipe.products) {
          rec.nominalOut.set(
            prod.item,
            (rec.nominalOut.get(prod.item) ?? 0) +
              prod.ratePerMinute * clockFrac * sloopMult,
          );
        }
        rec.staticPowerMW = -machinePower(building, clockFrac, sloopMult);
      }
    }
  } else if (node.kind === "extractor") {
    const building = dataset.buildings[node.buildingClass];
    const clockFrac = node.clockSpeed / 100;
    if (building && building.kind === "extractor") {
      const purity: Purity = node.purity;
      const rate = building.baseRatePerMinute * PURITY_MULTIPLIER[purity] * clockFrac;
      rec.nominalOut.set(node.resourceClass, rate);
      const exp = building.powerConsumptionExponent || DEFAULT_POWER_EXPONENT;
      rec.staticPowerMW = -building.basePowerMW * Math.pow(clockFrac, exp);
    }
  } else if (node.kind === "planInput") {
    rec.nominalOut.set(node.itemClass, node.ratePerMinute);
  } else if (node.kind === "planOutput") {
    rec.nominalIn.set(node.itemClass, node.ratePerMinute);
  }
  return rec;
}

function machinePower(
  building: Building | undefined,
  clockFrac: number,
  sloopMult: number,
): number {
  if (!building || !isManufacturer(building)) return 0;
  const exp = building.powerConsumptionExponent || DEFAULT_POWER_EXPONENT;
  const sloopPowerMult = sloopMult * sloopMult;
  return building.basePowerMW * Math.pow(clockFrac, exp) * sloopPowerMult;
}

function computeTotals(
  nodeRec: Map<string, NodeRec>,
  perNode: Record<string, NodeFlow>,
  surplus: Map<string, number>,
): PlanTotals {
  let powerBalanceMW = 0;
  const raw = new Map<string, number>();
  const net = new Map<string, number>();
  for (const rec of nodeRec.values()) {
    const flow = perNode[rec.id];
    if (!flow) continue;
    powerBalanceMW += flow.powerMW;
    if (rec.kind === "extractor" || rec.kind === "planInput") {
      for (const r of flow.actualOutputs) {
        raw.set(r.itemClass, (raw.get(r.itemClass) ?? 0) + r.ratePerMinute);
      }
    }
    if (rec.kind === "planOutput") {
      for (const r of flow.actualInputs) {
        net.set(r.itemClass, (net.get(r.itemClass) ?? 0) + r.ratePerMinute);
      }
    }
  }
  return {
    powerBalanceMW,
    rawInputs: mapToRates(raw),
    netOutputs: mapToRates(net),
    unplannedSurplus: mapToRates(surplus),
  };
}

function mapToRates(m: Map<string, number>): ItemRate[] {
  const out: ItemRate[] = [];
  for (const [itemClass, ratePerMinute] of m) out.push({ itemClass, ratePerMinute });
  return out;
}

function collectBrokenReferences(
  graph: PlanGraph,
  dataset: DatasetIndex,
): BrokenReference[] {
  const out: BrokenReference[] = [];
  const addr = (nodeId: string, kind: BrokenReference["kind"], ref: string) =>
    out.push({
      nodeId,
      kind,
      reference: ref,
      message: `${kind} "${ref}" is not present in dataset ${dataset.version}`,
    });
  for (const node of graph.nodes) {
    switch (node.kind) {
      case "machine":
        if (!dataset.buildings[node.buildingClass])
          addr(node.id, "building", node.buildingClass);
        if (node.recipeClass && !dataset.recipes[node.recipeClass])
          addr(node.id, "recipe", node.recipeClass);
        break;
      case "extractor":
        if (!dataset.buildings[node.buildingClass])
          addr(node.id, "building", node.buildingClass);
        if (!dataset.items[node.resourceClass])
          addr(node.id, "resource", node.resourceClass);
        break;
      case "splitter":
      case "merger":
        if (!dataset.buildings[node.buildingClass])
          addr(node.id, "building", node.buildingClass);
        break;
      case "planInput":
      case "planOutput":
        if (!dataset.items[node.itemClass]) addr(node.id, "item", node.itemClass);
        break;
    }
  }
  return out;
}

function detectBottlenecks(
  nodeRec: Map<string, NodeRec>,
  perNode: Record<string, NodeFlow>,
  perEdge: Record<string, EdgeFlow>,
  inEffMemo: Map<string, number>,
  outEffMemo: Map<string, number>,
  edgeItem: Map<string, string>,
  dataset: DatasetIndex,
): Bottleneck[] {
  const out: Bottleneck[] = [];
  const seenEdges = new Set<string>();
  const name = (itemClass: string) =>
    dataset.items[itemClass]?.displayName ?? itemClass;

  for (const rec of nodeRec.values()) {
    if (rec.broken) continue;
    if (rec.kind !== "machine" && rec.kind !== "extractor") continue;
    const flow = perNode[rec.id];
    if (!flow || flow.efficiency >= 100 - 1e-3) continue;
    const ie = inEffMemo.get(rec.id) ?? 1;
    const oe = outEffMemo.get(rec.id) ?? 1;

    if (ie <= oe && rec.nominalIn.size > 0) {
      // input-limited: pick the worst-satisfied input edge
      const edge = worstEdge(rec.inByItem, perEdge);
      if (edge) {
        seenEdges.add(edge.edgeId);
        const overCap = edge.overCapacity;
        out.push({
          nodeId: rec.id,
          edgeId: edge.edgeId,
          reason: overCap
            ? `Belt/Pipe capacity limits ${name(edge.itemClass)} supplied to this Machine`
            : `Insufficient ${name(edge.itemClass)} supply into this Machine`,
        });
      } else {
        out.push({ nodeId: rec.id, reason: "Machine is starved of input" });
      }
    } else if (rec.nominalOut.size > 0) {
      // output-limited (back-pressure)
      const edge = worstEdge(rec.outByItem, perEdge);
      if (edge) {
        seenEdges.add(edge.edgeId);
        out.push({
          nodeId: rec.id,
          edgeId: edge.edgeId,
          reason: edge.overCapacity
            ? `Belt/Pipe capacity limits ${name(edge.itemClass)} leaving this Machine`
            : `Output ${name(edge.itemClass)} cannot drain (back-pressure)`,
        });
      } else {
        out.push({ nodeId: rec.id, reason: "Machine output cannot drain" });
      }
    }
  }

  // Surface any over-capacity edge not already attributed.
  for (const edge of Object.values(perEdge)) {
    if (edge.overCapacity && !seenEdges.has(edge.edgeId)) {
      out.push({
        edgeId: edge.edgeId,
        reason: `Connection is over capacity carrying ${name(edge.itemClass)}`,
      });
    }
  }
  void edgeItem;
  return out;
}

function worstEdge(
  byItem: Map<string, string[]>,
  perEdge: Record<string, EdgeFlow>,
): EdgeFlow | undefined {
  let worst: EdgeFlow | undefined;
  let worstMetric = Infinity;
  for (const edges of byItem.values()) {
    for (const id of edges) {
      const ef = perEdge[id];
      if (!ef) continue;
      // The binding edge is the one carrying the least flow; an over-capacity edge
      // is always the prime suspect.
      const metric = ef.overCapacity ? -1 : ef.actualRatePerMinute;
      if (metric < worstMetric) {
        worstMetric = metric;
        worst = ef;
      }
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Edge item resolution
// ---------------------------------------------------------------------------

function resolveEdgeItems(
  graph: PlanGraph,
  nodeById: Map<string, PlanNode>,
  dataset: DatasetIndex,
): Map<string, string> {
  const edgeItem = new Map<string, string>();
  const inEdgesOf = new Map<string, PlanEdge[]>();
  const outEdgesOf = new Map<string, PlanEdge[]>();
  for (const e of graph.edges) {
    push2(inEdgesOf, e.target, e);
    push2(outEdgesOf, e.source, e);
  }

  function downstreamConsumed(nodeId: string, visited: Set<string>): string[] {
    const node = nodeById.get(nodeId);
    if (!node) return [];
    const inItems = nodeInItems(node, dataset);
    if (inItems !== null) return inItems;
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);
    const acc: string[] = [];
    for (const e of outEdgesOf.get(nodeId) ?? []) {
      acc.push(...downstreamConsumed(e.target, visited));
    }
    return acc;
  }

  function throughItem(nodeId: string, visited: Set<string>): string | undefined {
    if (visited.has(nodeId)) return undefined;
    visited.add(nodeId);
    for (const e of inEdgesOf.get(nodeId) ?? []) {
      const it = resolve(e, visited);
      if (it) return it;
    }
    return undefined;
  }

  function resolve(edge: PlanEdge, visited: Set<string>): string | undefined {
    const cached = edgeItem.get(edge.id);
    if (cached) return cached;
    const src = nodeById.get(edge.source);
    if (!src) return undefined;
    const outItems = nodeOutItems(src, dataset);
    let item: string | undefined;
    if (outItems === null) {
      item = throughItem(edge.source, new Set(visited));
    } else if (outItems.length === 1) {
      item = outItems[0];
    } else if (outItems.length === 0) {
      item = undefined;
    } else {
      const wanted = downstreamConsumed(edge.target, new Set());
      item = outItems.find((c) => wanted.includes(c)) ?? outItems[0];
    }
    if (item) edgeItem.set(edge.id, item);
    return item;
  }

  for (const e of graph.edges) resolve(e, new Set());
  return edgeItem;
}

function push2(map: Map<string, PlanEdge[]>, key: string, value: PlanEdge): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}
