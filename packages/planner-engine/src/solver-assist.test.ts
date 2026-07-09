import { describe, expect, test } from "bun:test";

import { computeFlows } from "./flow";
import type { MachineNode, PlanNode } from "./graph";
import { expandChain } from "./solver-assist";
import {
  belt,
  extractor,
  graph,
  machine,
  makeDataset,
  planOutput,
  resetIds,
} from "./fixtures";

const dataset = makeDataset();

function byKind(nodes: PlanNode[], kind: PlanNode["kind"]): PlanNode[] {
  return nodes.filter((n) => n.kind === kind);
}

describe("expandChain", () => {
  test("expands the Iron Plate chain to a Smelter and a Miner", () => {
    resetIds();
    const constructor = machine("Build_ConstructorMk1_C", "Recipe_IronPlate_C");
    const sink = planOutput("Desc_IronPlate_C", 20);
    const g = graph([constructor, sink], [belt(constructor, sink)]);

    const exp = expandChain(g, constructor.id, dataset, {});

    const machines = byKind(exp.nodes, "machine") as MachineNode[];
    const miners = byKind(exp.nodes, "extractor");
    // Exactly one Smelter (standard Iron Ingot) and one Miner, no logistics needed.
    expect(machines).toHaveLength(1);
    expect(machines[0]?.recipeClass).toBe("Recipe_IronIngot_C");
    expect(machines[0]?.buildingClass).toBe("Build_SmelterMk1_C");
    expect(miners).toHaveLength(1);
    expect(byKind(exp.nodes, "splitter")).toHaveLength(0);
    expect(byKind(exp.nodes, "merger")).toHaveLength(0);

    // Belt from the Smelter into the Constructor's iron-ingot port.
    const feed = exp.edges.find((e) => e.target === constructor.id);
    expect(feed?.sourceHandle).toBe("out::Desc_IronIngot_C");
    expect(feed?.targetHandle).toBe("in::Desc_IronIngot_C");

    // The whole plan solves at 100% once the expansion is applied.
    const full = graph([...g.nodes, ...exp.nodes], [...g.edges, ...exp.edges]);
    const r = computeFlows(full, dataset);
    expect(r.perNode[constructor.id]?.efficiency).toBeCloseTo(100, 2);
  });

  test("honors a Recipe Preference for an alternate recipe", () => {
    resetIds();
    const constructor = machine("Build_ConstructorMk1_C", "Recipe_IronPlate_C");
    const sink = planOutput("Desc_IronPlate_C", 20);
    const g = graph([constructor, sink], [belt(constructor, sink)]);

    const exp = expandChain(g, constructor.id, dataset, {
      Desc_IronIngot_C: "Recipe_Alternate_IronIngot_C",
    });

    const machines = byKind(exp.nodes, "machine") as MachineNode[];
    expect(machines).toHaveLength(1);
    expect(machines[0]?.recipeClass).toBe("Recipe_Alternate_IronIngot_C");
    // Alt makes 60 ingot/machine; 30 demanded → underclocked to 50%.
    expect(machines[0]?.clockSpeed).toBeCloseTo(50, 2);

    const full = graph([...g.nodes, ...exp.nodes], [...g.edges, ...exp.edges]);
    const r = computeFlows(full, dataset);
    expect(r.perNode[constructor.id]?.efficiency).toBeCloseTo(100, 2);
  });

  test("stops at an item already produced with surplus in the graph", () => {
    resetIds();
    // An existing Smelter making 30 ingot/min with no consumers — pure surplus.
    const existingSmelter = machine("Build_SmelterMk1_C", "Recipe_IronIngot_C");
    const constructor = machine("Build_ConstructorMk1_C", "Recipe_IronPlate_C");
    const sink = planOutput("Desc_IronPlate_C", 20);
    const g = graph(
      [existingSmelter, constructor, sink],
      [belt(constructor, sink)],
    );

    const exp = expandChain(g, constructor.id, dataset, {});

    // No new machines or extractors: the demand is met from surplus.
    expect(byKind(exp.nodes, "machine")).toHaveLength(0);
    expect(byKind(exp.nodes, "extractor")).toHaveLength(0);
    expect(exp.edges).toHaveLength(1);
    expect(exp.edges[0]?.source).toBe(existingSmelter.id);
    expect(exp.edges[0]?.target).toBe(constructor.id);
  });

  test("sizes multiple machines and merges them into one port", () => {
    resetIds();
    // 250% clock → 75 ingot/min demand → 3 Smelters (30+30+15) merged into one belt.
    const constructor = machine("Build_ConstructorMk1_C", "Recipe_IronPlate_C", {
      clockSpeed: 250,
    });
    const sink = planOutput("Desc_IronPlate_C", 50);
    const g = graph([constructor, sink], [belt(constructor, sink)]);

    const exp = expandChain(g, constructor.id, dataset, {});

    const smelters = byKind(exp.nodes, "machine") as MachineNode[];
    expect(smelters).toHaveLength(3);
    const clocks = smelters.map((m) => m.clockSpeed).sort((a, b) => a - b);
    expect(clocks).toEqual([50, 100, 100]);
    // One Merger combines the three Smelters into the Constructor's ingot port.
    expect(byKind(exp.nodes, "merger")).toHaveLength(1);
    // Three Miners feed the three Smelters.
    expect(byKind(exp.nodes, "extractor")).toHaveLength(3);

    // The Merger has exactly three inbound belts, one per Smelter, all on its
    // three input ports, and a single belt out to the Constructor.
    const merger = byKind(exp.nodes, "merger")[0];
    const intoMerger = exp.edges.filter((e) => e.target === merger?.id);
    expect(intoMerger).toHaveLength(3);
    expect(new Set(intoMerger.map((e) => e.targetHandle))).toEqual(
      new Set(["in0", "in1", "in2"]),
    );
    const outOfMerger = exp.edges.filter((e) => e.source === merger?.id);
    expect(outOfMerger).toHaveLength(1);
    expect(outOfMerger[0]?.target).toBe(constructor.id);
  });

  test("chooses the lowest Belt Mk that carries the flow", () => {
    resetIds();
    const constructor = machine("Build_ConstructorMk1_C", "Recipe_IronPlate_C");
    const sink = planOutput("Desc_IronPlate_C", 20);
    const g = graph([constructor, sink], [belt(constructor, sink)]);

    const exp = expandChain(g, constructor.id, dataset, {});
    // 30 ingot/min needs Belt Mk1 (60). Never picks a higher Mk than required.
    const feed = exp.edges.find((e) => e.target === constructor.id);
    expect(feed?.mk).toBe(1);
  });

  test("no-op for a node without a recipe", () => {
    resetIds();
    const ext = extractor("Build_MinerMk1_C", "Desc_OreIron_C");
    const g = graph([ext], []);
    const exp = expandChain(g, ext.id, dataset, {});
    expect(exp.nodes).toHaveLength(0);
    expect(exp.edges).toHaveLength(0);
  });
});
