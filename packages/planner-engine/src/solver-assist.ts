/**
 * Solver Assist (see CONTEXT.md). Given a Machine node with unmet ingredient
 * demand, {@link expandChain} generates the upstream Machines, Extractors, and the
 * Splitter/Merger + Belt/Pipe logistics needed to feed it — choosing recipes via
 * the Plan's {@link RecipePreferences} (default: the item's standard, non-alternate
 * recipe). It is pure TypeScript (no DOM/React); the UI applies the returned nodes
 * and edges to the graph and lays the new nodes out.
 *
 * ## What it does
 *
 * Starting from the target Machine's clock-adjusted ingredient demand (netted
 * against whatever existing edges already supply), it walks upstream breadth-first.
 * For each unmet item demand it, in order:
 *   1. draws from **existing surplus** — a producer already in the graph that makes
 *      that item with spare, unallocated output (stops the chain there);
 *   2. emits an **Extractor** when the item is a raw resource (stops the chain);
 *   3. otherwise builds **Machines** running the preferred recipe, sized to satisfy
 *      the demand at 100% clock — `ceil(demand / perMachine)` machines with the last
 *      one underclocked to match the remainder exactly — and recurses into each new
 *      Machine's own ingredient demand.
 *
 * Producers feeding one consumer port are combined through a **Merger** tree; a
 * single producer feeding several consumers is fanned out through a **Splitter**
 * tree (ADR-0004: flow never splits/merges implicitly at a Machine port). Each
 * Belt/Pipe is the lowest Mk that carries its flow.
 */

import {
  isManufacturer,
  PURITY_MULTIPLIER,
  standardRecipeFor,
} from "@satisfactory-tools/game-data";
import type {
  BeltMk,
  Building,
  DatasetIndex,
  ExtractorBuilding,
  PipeMk,
  Recipe,
} from "@satisfactory-tools/game-data";

import { computeFlows, type FlowResult } from "./flow";
import type {
  ExtractorNode,
  MachineNode,
  PlanEdge,
  PlanGraph,
  PlanNode,
  RecipePreferences,
} from "./graph";

const EPSILON = 1e-6;

/** New nodes and edges to add to the graph to satisfy a target's demand. */
export interface ChainExpansion {
  nodes: PlanNode[];
  edges: PlanEdge[];
}

/** A connection endpoint: a node id and one of its named handles. */
interface Ref {
  nodeId: string;
  handle: string;
}

/** A logical producer→consumer connection carrying `rate` of `item`. */
interface Link {
  producer: Ref;
  consumer: Ref;
  item: string;
  rate: number;
}

/**
 * Expand the upstream ingredient chain of a Machine node into new nodes/edges.
 *
 * @param graph              The current Plan graph (read-only; not mutated).
 * @param targetNodeId       The Machine node whose inputs to expand.
 * @param dataset            The pinned Game Dataset.
 * @param recipePreferences  Per-item chosen recipe; falls back to the standard one.
 * @returns The nodes and edges to add. Empty when there is nothing to expand.
 */
export function expandChain(
  graph: PlanGraph,
  targetNodeId: string,
  dataset: DatasetIndex,
  recipePreferences: RecipePreferences,
): ChainExpansion {
  const target = graph.nodes.find((n) => n.id === targetNodeId);
  if (!target || target.kind !== "machine" || !target.recipeClass) {
    return { nodes: [], edges: [] };
  }
  const targetRecipe = dataset.recipes[target.recipeClass];
  if (!targetRecipe) return { nodes: [], edges: [] };

  const flow = computeFlows(graph, dataset);
  const ctx = new ExpandContext(graph, dataset, recipePreferences, flow);
  const targetClock = target.clockSpeed / 100;

  // Seed the work queue with the target's unmet ingredient demand.
  for (const ing of targetRecipe.ingredients) {
    const demand = ing.ratePerMinute * targetClock;
    const unmet = demand - ctx.existingSupply(targetNodeId, ing.item);
    if (unmet > EPSILON) {
      ctx.enqueue({
        item: ing.item,
        rate: unmet,
        consumer: { nodeId: targetNodeId, handle: `in::${ing.item}` },
      });
    }
  }

  ctx.run();
  return ctx.finish();
}

interface Demand {
  item: string;
  rate: number;
  consumer: Ref;
}

let ID_SEQ = 0;

class ExpandContext {
  private readonly queue: Demand[] = [];
  private readonly links: Link[] = [];
  private readonly nodes: PlanNode[] = [];
  /** item → producers (existing + added) with spare output, mutated as drawn. */
  private readonly surplus = new Map<string, { ref: Ref; spare: number }[]>();

  constructor(
    private readonly graph: PlanGraph,
    private readonly dataset: DatasetIndex,
    private readonly prefs: RecipePreferences,
    private readonly flow: FlowResult,
  ) {
    this.initSurplus();
  }

  enqueue(d: Demand): void {
    this.queue.push(d);
  }

  run(): void {
    let guard = 0;
    while (this.queue.length > 0 && guard++ < 10000) {
      const d = this.queue.shift();
      if (d) this.resolve(d);
    }
  }

  finish(): ChainExpansion {
    const logistics = this.buildLogistics();
    return {
      nodes: [...this.nodes, ...logistics.nodes],
      edges: logistics.edges,
    };
  }

  // -- demand resolution -----------------------------------------------------

  private resolve(d: Demand): void {
    let remaining = d.rate;

    // 1. Draw from existing/added surplus first.
    const pool = this.surplus.get(d.item);
    if (pool) {
      for (const entry of pool) {
        if (remaining <= EPSILON) break;
        if (entry.spare <= EPSILON) continue;
        const take = Math.min(entry.spare, remaining);
        entry.spare -= take;
        remaining -= take;
        this.links.push({
          producer: entry.ref,
          consumer: d.consumer,
          item: d.item,
          rate: take,
        });
      }
    }
    if (remaining <= EPSILON) return;

    // 2. Raw resource → Extractor(s).
    const item = this.dataset.items[d.item];
    if (item?.isRawResource) {
      this.buildExtractors(d.item, remaining, d.consumer);
      return;
    }

    // 3. Build Machines running the preferred recipe.
    const recipe = this.chooseRecipe(d.item);
    if (!recipe) return; // no recipe available; leave unmet (chain stops)
    this.buildMachines(recipe, d.item, remaining, d.consumer);
  }

  private buildMachines(
    recipe: Recipe,
    item: string,
    demand: number,
    consumer: Ref,
  ): void {
    const perMachine = recipe.products
      .filter((p) => p.item === item)
      .reduce((s, p) => s + p.ratePerMinute, 0);
    if (perMachine <= EPSILON) return;

    const building = this.dataset.buildings[recipe.producedIn];
    const count = Math.max(1, Math.ceil(demand / perMachine - EPSILON));
    for (let k = 0; k < count; k++) {
      const isLast = k === count - 1;
      const produced = isLast ? demand - perMachine * (count - 1) : perMachine;
      const clockFrac = produced / perMachine;
      const node = this.makeMachine(recipe, building, clockFrac);
      this.nodes.push(node);
      this.links.push({
        producer: { nodeId: node.id, handle: `out::${item}` },
        consumer,
        item,
        rate: produced,
      });
      // Any other product of this recipe is a byproduct with its own surplus.
      for (const p of recipe.products) {
        if (p.item === item) continue;
        this.addSurplus(p.item, {
          ref: { nodeId: node.id, handle: `out::${p.item}` },
          spare: p.ratePerMinute * clockFrac,
        });
      }
      // Recurse into this machine's ingredient demand.
      for (const ing of recipe.ingredients) {
        this.enqueue({
          item: ing.item,
          rate: ing.ratePerMinute * clockFrac,
          consumer: { nodeId: node.id, handle: `in::${ing.item}` },
        });
      }
    }
  }

  private buildExtractors(
    resource: string,
    demand: number,
    consumer: Ref,
  ): void {
    const building = this.pickExtractor(resource);
    if (!building) return;
    const perExtractor = building.baseRatePerMinute * PURITY_MULTIPLIER.normal;
    if (perExtractor <= EPSILON) return;
    const count = Math.max(1, Math.ceil(demand / perExtractor - EPSILON));
    for (let k = 0; k < count; k++) {
      const isLast = k === count - 1;
      const produced = isLast ? demand - perExtractor * (count - 1) : perExtractor;
      const clockFrac = produced / perExtractor;
      const node: ExtractorNode = {
        id: this.newId("x"),
        kind: "extractor",
        position: { x: 0, y: 0 },
        buildingClass: building.className,
        resourceClass: resource,
        mk: building.mk,
        clockSpeed: roundClock(clockFrac * 100),
        purity: "normal",
      };
      this.nodes.push(node);
      this.links.push({
        producer: { nodeId: node.id, handle: `out::${resource}` },
        consumer,
        item: resource,
        rate: produced,
      });
    }
  }

  // -- recipe / building selection -------------------------------------------

  private chooseRecipe(item: string): Recipe | undefined {
    const preferred = this.prefs[item];
    if (preferred) {
      const recipe = this.dataset.recipes[preferred];
      if (recipe && recipe.products.some((p) => p.item === item)) return recipe;
    }
    return standardRecipeFor(this.dataset, item);
  }

  private pickExtractor(resource: string): ExtractorBuilding | undefined {
    const candidates = Object.values(this.dataset.buildings).filter(
      (b): b is ExtractorBuilding =>
        b.kind === "extractor" && b.allowedResources.includes(resource),
    );
    if (candidates.length === 0) return undefined;
    // Prefer the highest-Mk miner (fewest buildings); non-miners have no Mk.
    return candidates.sort((a, b) => (b.mk ?? 0) - (a.mk ?? 0))[0];
  }

  private makeMachine(
    recipe: Recipe,
    building: Building | undefined,
    clockFrac: number,
  ): MachineNode {
    return {
      id: this.newId("m"),
      kind: "machine",
      position: { x: 0, y: 0 },
      buildingClass: building?.className ?? recipe.producedIn,
      recipeClass: recipe.className,
      clockSpeed: roundClock(clockFrac * 100),
      somersloops: 0,
    };
  }

  // -- surplus ---------------------------------------------------------------

  private addSurplus(item: string, entry: { ref: Ref; spare: number }): void {
    const pool = this.surplus.get(item);
    if (pool) pool.push(entry);
    else this.surplus.set(item, [entry]);
  }

  /**
   * Seed the surplus pool from producer outputs that are not already feeding
   * something. Spare is the ACTUAL steady-state production (a starved producer
   * offers only what it really makes), so the planner builds enough new producers
   * rather than oversubscribing an already-strained one.
   */
  private initSurplus(): void {
    const usedOutputs = new Set<string>();
    for (const e of this.graph.edges) {
      usedOutputs.add(`${e.source} ${e.sourceHandle}`);
    }
    for (const node of this.graph.nodes) {
      const actual = this.flow.perNode[node.id]?.actualOutputs ?? [];
      for (const { itemClass: item, ratePerMinute: made } of actual) {
        if (made <= EPSILON) continue;
        const handle = `out::${item}`;
        if (usedOutputs.has(`${node.id} ${handle}`)) continue;
        this.addSurplus(item, { ref: { nodeId: node.id, handle }, spare: made });
      }
    }
  }

  /** How much of `item` existing edges already deliver into `nodeId`. */
  existingSupply(nodeId: string, item: string): number {
    let supplied = 0;
    for (const e of this.graph.edges) {
      if (e.target !== nodeId) continue;
      if (e.targetHandle !== `in::${item}`) continue;
      const producer = this.graph.nodes.find((n) => n.id === e.source);
      if (producer) supplied += this.nominalOutputs(producer).get(item) ?? 0;
    }
    return supplied;
  }

  private nominalOutputs(node: PlanNode): Map<string, number> {
    const out = new Map<string, number>();
    if (node.kind === "planInput") {
      out.set(node.itemClass, node.ratePerMinute);
    } else if (node.kind === "extractor") {
      const b = this.dataset.buildings[node.buildingClass];
      if (b && b.kind === "extractor") {
        out.set(
          node.resourceClass,
          b.baseRatePerMinute *
            PURITY_MULTIPLIER[node.purity] *
            (node.clockSpeed / 100),
        );
      }
    } else if (node.kind === "machine" && node.recipeClass) {
      const recipe = this.dataset.recipes[node.recipeClass];
      const b = this.dataset.buildings[node.buildingClass];
      if (recipe) {
        const slots = b && isManufacturer(b) ? b.somersloopSlots : 0;
        const sloopMult = slots > 0 ? 1 + node.somersloops / slots : 1;
        const clockFrac = node.clockSpeed / 100;
        for (const p of recipe.products) {
          out.set(
            p.item,
            (out.get(p.item) ?? 0) + p.ratePerMinute * clockFrac * sloopMult,
          );
        }
      }
    }
    return out;
  }

  // -- logistics (splitters / mergers / belts) -------------------------------

  private buildLogistics(): { nodes: PlanNode[]; edges: PlanEdge[] } {
    const acc: { nodes: PlanNode[]; edges: PlanEdge[] } = { nodes: [], edges: [] };

    // Fan-out: a producer output feeding >1 consumer needs a Splitter tree.
    const byProducer = new Map<string, Link[]>();
    for (const link of this.links) {
      const key = `${link.producer.nodeId}::${link.producer.handle}`;
      const arr = byProducer.get(key);
      if (arr) arr.push(link);
      else byProducer.set(key, [link]);
    }
    for (const group of byProducer.values()) {
      if (group.length <= 1) continue;
      const first = group[0];
      if (!first) continue;
      const outs = this.splitTo(
        first.producer,
        group.map((l) => l.rate),
        first.item,
        acc,
      );
      group.forEach((l, i) => {
        const ref = outs[i];
        if (ref) l.producer = ref;
      });
    }

    // Fan-in: a consumer port fed by >1 producer needs a Merger tree.
    const byConsumer = new Map<string, Link[]>();
    for (const link of this.links) {
      const key = `${link.consumer.nodeId}::${link.consumer.handle}`;
      const arr = byConsumer.get(key);
      if (arr) arr.push(link);
      else byConsumer.set(key, [link]);
    }
    for (const group of byConsumer.values()) {
      const first = group[0];
      if (!first) continue;
      if (group.length === 1) {
        acc.edges.push(this.makeEdge(first.producer, first.consumer, first.item, first.rate));
        continue;
      }
      const total = group.reduce((s, l) => s + l.rate, 0);
      const root = this.mergeFrom(
        group.map((l) => ({ ref: l.producer, rate: l.rate })),
        first.item,
        acc,
      );
      acc.edges.push(this.makeEdge(root, first.consumer, first.item, total));
    }

    return acc;
  }

  /** Build a Merger tree combining `sources` into one output ref carrying the sum. */
  private mergeFrom(
    sources: { ref: Ref; rate: number }[],
    item: string,
    acc: { nodes: PlanNode[]; edges: PlanEdge[] },
  ): Ref {
    if (sources.length === 1) {
      const only = sources[0];
      if (only) return only.ref;
    }
    if (sources.length <= 3) {
      const merger = this.makeLogistics("merger");
      acc.nodes.push(merger);
      sources.forEach((s, i) => {
        acc.edges.push(
          this.makeEdge(s.ref, { nodeId: merger.id, handle: `in${i}` }, item, s.rate),
        );
      });
      return { nodeId: merger.id, handle: "out" };
    }
    const groups = chunk(sources, 3);
    const merged = groups.map((g) => ({
      ref: this.mergeFrom(g, item, acc),
      rate: g.reduce((s, x) => s + x.rate, 0),
    }));
    return this.mergeFrom(merged, item, acc);
  }

  /** Build a Splitter tree distributing `inputRef` across `rates.length` outputs. */
  private splitTo(
    inputRef: Ref,
    rates: number[],
    item: string,
    acc: { nodes: PlanNode[]; edges: PlanEdge[] },
  ): Ref[] {
    const splitter = this.makeLogistics("splitter");
    acc.nodes.push(splitter);
    const total = rates.reduce((s, r) => s + r, 0);
    acc.edges.push(
      this.makeEdge(inputRef, { nodeId: splitter.id, handle: "in" }, item, total),
    );
    if (rates.length <= 3) {
      return rates.map((_, i) => ({ nodeId: splitter.id, handle: `out${i}` }));
    }
    // A Splitter has 3 outputs; partition the sinks into 3 near-even branches and
    // recurse on any branch that still carries more than one sink.
    const groups = partitionIndices(rates.length, 3);
    const outRefs = new Array<Ref>(rates.length);
    groups.forEach((idxs, gi) => {
      const branch: Ref = { nodeId: splitter.id, handle: `out${gi}` };
      if (idxs.length === 1) {
        const only = idxs[0];
        if (only !== undefined) outRefs[only] = branch;
      } else {
        const sub = this.splitTo(branch, idxs.map((i) => rates[i] ?? 0), item, acc);
        idxs.forEach((i, k) => {
          const ref = sub[k];
          if (ref) outRefs[i] = ref;
        });
      }
    });
    return outRefs;
  }

  private makeLogistics(kind: "splitter" | "merger"): PlanNode {
    const building = Object.values(this.dataset.buildings).find(
      (b) => b.kind === kind,
    );
    const buildingClass = building?.className ?? (kind === "splitter" ? "Build_Splitter_C" : "Build_Merger_C");
    if (kind === "splitter") {
      return { id: this.newId("s"), kind: "splitter", position: { x: 0, y: 0 }, buildingClass };
    }
    return { id: this.newId("g"), kind: "merger", position: { x: 0, y: 0 }, buildingClass };
  }

  private makeEdge(source: Ref, target: Ref, item: string, rate: number): PlanEdge {
    const form = this.dataset.items[item]?.form;
    const isFluid = form === "liquid" || form === "gas";
    const kind = isFluid ? "pipe" : "belt";
    const mk: BeltMk | PipeMk = isFluid
      ? this.lowestPipeMk(rate)
      : this.lowestBeltMk(rate);
    return {
      id: this.newId("e"),
      kind,
      mk,
      source: source.nodeId,
      sourceHandle: source.handle,
      target: target.nodeId,
      targetHandle: target.handle,
    };
  }

  private lowestBeltMk(rate: number): BeltMk {
    const mks: BeltMk[] = [1, 2, 3, 4, 5, 6];
    for (const mk of mks) {
      if ((this.dataset.beltCapacity[mk] ?? 0) >= rate - EPSILON) return mk;
    }
    return 6;
  }

  private lowestPipeMk(rate: number): PipeMk {
    const mks: PipeMk[] = [1, 2];
    for (const mk of mks) {
      if ((this.dataset.pipeCapacity[mk] ?? 0) >= rate - EPSILON) return mk;
    }
    return 2;
  }

  private newId(prefix: string): string {
    ID_SEQ += 1;
    return `${prefix}_exp_${Date.now().toString(36)}_${ID_SEQ}`;
  }
}

/**
 * Round a clock-speed percentage to 6 decimals — enough to keep the chain exact
 * (a machine's clock is `demand/capacity·100`, which is often a repeating decimal)
 * while trimming binary-float noise.
 */
function roundClock(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Partition [0, length) into at most `parts` contiguous, near-even groups. */
function partitionIndices(length: number, parts: number): number[][] {
  const idx = Array.from({ length }, (_, i) => i);
  const n = Math.min(parts, length);
  const base = Math.floor(length / n);
  const rem = length % n;
  const out: number[][] = [];
  let start = 0;
  for (let g = 0; g < n; g++) {
    const size = base + (g < rem ? 1 : 0);
    out.push(idx.slice(start, start + size));
    start += size;
  }
  return out;
}
