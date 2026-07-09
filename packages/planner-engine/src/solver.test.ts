import { describe, expect, test } from "bun:test";

import { computeFlows } from "./flow";
import type { PlanNode } from "./graph";
import {
  belt,
  extractor,
  generator,
  graph,
  machine,
  makeDataset,
  merger,
  pipe,
  planInput,
  planOutput,
  resetIds,
  splitter,
} from "./fixtures";

const dataset = makeDataset();
const CLOSE = 1e-4;

function eff(result: ReturnType<typeof computeFlows>, node: PlanNode): number {
  const f = result.perNode[node.id];
  if (!f) throw new Error(`no node flow for ${node.id}`);
  return f.efficiency;
}
function outRate(
  result: ReturnType<typeof computeFlows>,
  node: PlanNode,
  itemClass: string,
): number {
  const f = result.perNode[node.id];
  return f?.actualOutputs.find((r) => r.itemClass === itemClass)?.ratePerMinute ?? 0;
}
function inRate(
  result: ReturnType<typeof computeFlows>,
  node: PlanNode,
  itemClass: string,
): number {
  const f = result.perNode[node.id];
  return f?.actualInputs.find((r) => r.itemClass === itemClass)?.ratePerMinute ?? 0;
}

describe("computeFlows", () => {
  test("simple chain runs at 100%", () => {
    resetIds();
    const src = planInput("Desc_OreIron_C", 30);
    const smelter = machine("Build_SmelterMk1_C", "Recipe_IronIngot_C");
    const sink = planOutput("Desc_IronIngot_C", 30);
    const g = graph(
      [src, smelter, sink],
      [belt(src, smelter), belt(smelter, sink)],
    );
    const r = computeFlows(g, dataset);
    expect(eff(r, smelter)).toBeCloseTo(100, 3);
    expect(outRate(r, smelter, "Desc_IronIngot_C")).toBeCloseTo(30, 4);
    expect(inRate(r, smelter, "Desc_OreIron_C")).toBeCloseTo(30, 4);
    expect(r.diagnostics.bottlenecks).toHaveLength(0);
  });

  test("starved chain runs at reduced efficiency", () => {
    resetIds();
    const src = planInput("Desc_OreIron_C", 15); // needs 30
    const smelter = machine("Build_SmelterMk1_C", "Recipe_IronIngot_C");
    const sink = planOutput("Desc_IronIngot_C", 30);
    const g = graph(
      [src, smelter, sink],
      [belt(src, smelter), belt(smelter, sink)],
    );
    const r = computeFlows(g, dataset);
    expect(eff(r, smelter)).toBeCloseTo(50, 3);
    expect(outRate(r, smelter, "Desc_IronIngot_C")).toBeCloseTo(15, 4);
    expect(r.diagnostics.bottlenecks.length).toBeGreaterThan(0);
    expect(r.diagnostics.bottlenecks[0]?.nodeId).toBe(smelter.id);
  });

  test("back-pressure: a blocked output slows the producer", () => {
    resetIds();
    const src = planInput("Desc_OreIron_C", 30);
    const smelter = machine("Build_SmelterMk1_C", "Recipe_IronIngot_C");
    const sink = planOutput("Desc_IronIngot_C", 15); // can only drain 15
    const g = graph(
      [src, smelter, sink],
      [belt(src, smelter), belt(smelter, sink)],
    );
    const r = computeFlows(g, dataset);
    expect(eff(r, smelter)).toBeCloseTo(50, 3);
    // producer consumes only what its throttled output allows
    expect(inRate(r, smelter, "Desc_OreIron_C")).toBeCloseTo(15, 4);
    expect(outRate(r, smelter, "Desc_IronIngot_C")).toBeCloseTo(15, 4);
    // the upstream Plan Input is itself back-pressured to 50%
    expect(eff(r, src)).toBeCloseTo(50, 3);
  });

  test("splitter splits evenly with overflow redistribution", () => {
    resetIds();
    const src = planInput("Desc_OreIron_C", 60);
    const sp = splitter();
    const smallSink = planOutput("Desc_OreIron_C", 10); // accepts only 10
    const bigSink = planOutput("Desc_OreIron_C", 100); // accepts the rest
    const eA = belt(src, sp);
    const eB = belt(sp, smallSink, 6, { sourceHandle: "out0" });
    const eC = belt(sp, bigSink, 6, { sourceHandle: "out1" });
    const g = graph([src, sp, smallSink, bigSink], [eA, eB, eC]);
    const r = computeFlows(g, dataset);
    // even split would give 30/30, but branch A saturates at 10, so 20 overflows to B
    expect(r.perEdge[eB.id]?.actualRatePerMinute).toBeCloseTo(10, 4);
    expect(r.perEdge[eC.id]?.actualRatePerMinute).toBeCloseTo(50, 4);
    expect(r.perEdge[eA.id]?.actualRatePerMinute).toBeCloseTo(60, 4);
  });

  test("merger sums its inputs", () => {
    resetIds();
    const a = planInput("Desc_OreIron_C", 20);
    const b = planInput("Desc_OreIron_C", 40);
    const mg = merger();
    const sink = planOutput("Desc_OreIron_C", 100);
    const eOut = belt(mg, sink, 6);
    const g = graph(
      [a, b, mg, sink],
      [
        belt(a, mg, 6, { targetHandle: "in0" }),
        belt(b, mg, 6, { targetHandle: "in1" }),
        eOut,
      ],
    );
    const r = computeFlows(g, dataset);
    expect(r.perEdge[eOut.id]?.actualRatePerMinute).toBeCloseTo(60, 4);
  });

  test("over-capacity belt clamps flow and is flagged", () => {
    resetIds();
    const src = planInput("Desc_OreIron_C", 300);
    const sink = planOutput("Desc_OreIron_C", 300);
    const e = belt(src, sink, 1); // Mk1 = 60/min
    const g = graph([src, sink], [e]);
    const r = computeFlows(g, dataset);
    expect(r.perEdge[e.id]?.actualRatePerMinute).toBeCloseTo(60, 4);
    expect(r.perEdge[e.id]?.overCapacity).toBe(true);
    expect(r.diagnostics.bottlenecks.some((b) => b.edgeId === e.id)).toBe(true);
  });

  test("clock speed scales rate linearly and power super-linearly", () => {
    resetIds();
    const src = planInput("Desc_OreIron_C", 75); // 30 * 2.5
    const smelter = machine("Build_SmelterMk1_C", "Recipe_IronIngot_C", {
      clockSpeed: 250,
    });
    const sink = planOutput("Desc_IronIngot_C", 100);
    const g = graph(
      [src, smelter, sink],
      [belt(src, smelter, 6), belt(smelter, sink, 6)],
    );
    const r = computeFlows(g, dataset);
    expect(eff(r, smelter)).toBeCloseTo(100, 3);
    expect(outRate(r, smelter, "Desc_IronIngot_C")).toBeCloseTo(75, 4);
    // power = basePower(4) * (2.5)^1.321928 ≈ 4 * 3.35682 = 13.4273, drawn (negative)
    const power = r.perNode[smelter.id]?.powerMW ?? 0;
    expect(power).toBeLessThan(0);
    // 250% clock => power multiplier (2.5)^1.321928 ≈ 3.3568x (within tolerance)
    expect(-power / 4).toBeCloseTo(3.3568, 2);
  });

  test("machine below 100% still draws full power", () => {
    resetIds();
    const src = planInput("Desc_OreIron_C", 15); // 50% fed
    const smelter = machine("Build_SmelterMk1_C", "Recipe_IronIngot_C");
    const sink = planOutput("Desc_IronIngot_C", 30);
    const g = graph([src, smelter, sink], [belt(src, smelter), belt(smelter, sink)]);
    const r = computeFlows(g, dataset);
    expect(eff(r, smelter)).toBeCloseTo(50, 3);
    // full base power at 100% clock = 4 MW despite 50% efficiency
    expect(-(r.perNode[smelter.id]?.powerMW ?? 0)).toBeCloseTo(4, 4);
  });

  test("somersloops double output and quadruple power", () => {
    resetIds();
    const src = planInput("Desc_IronIngot_C", 30);
    const constructor = machine("Build_ConstructorMk1_C", "Recipe_IronPlate_C", {
      somersloops: 1, // 1 of 1 slots -> output x2
    });
    const sink = planOutput("Desc_IronPlate_C", 100);
    const g = graph(
      [src, constructor, sink],
      [belt(src, constructor, 6), belt(constructor, sink, 6)],
    );
    const r = computeFlows(g, dataset);
    expect(eff(r, constructor)).toBeCloseTo(100, 3);
    // base output 20 plate -> doubled to 40; input unchanged at 30
    expect(outRate(r, constructor, "Desc_IronPlate_C")).toBeCloseTo(40, 4);
    expect(inRate(r, constructor, "Desc_IronIngot_C")).toBeCloseTo(30, 4);
    // power multiplier = outputMult^2 = 4; base 4 MW -> 16 MW
    expect(-(r.perNode[constructor.id]?.powerMW ?? 0)).toBeCloseTo(16, 3);
  });

  test("extractor rate scales with purity and clamps to belt capacity", () => {
    resetIds();
    // Miner base 60, pure x2 = 120, but Mk1 belt clamps to 60
    const miner = extractor("Build_MinerMk1_C", "Desc_OreIron_C", { purity: "pure" });
    const sink = planOutput("Desc_OreIron_C", 300);
    const e = belt(miner, sink, 1); // 60/min
    const g = graph([miner, sink], [e]);
    const r = computeFlows(g, dataset);
    expect(r.perEdge[e.id]?.actualRatePerMinute).toBeCloseTo(60, 4);
    // clamped nominal == 60, fully drained -> 100% efficiency
    expect(eff(r, miner)).toBeCloseTo(100, 3);
  });

  test("generator produces power from fuel and contributes to power balance", () => {
    resetIds();
    const fuel = planInput("Desc_Coal_C", 15); // 60*75/300 = 15 coal/min
    const gen = generator("Build_GeneratorCoal_C");
    const g = graph([fuel, gen], [belt(fuel, gen, 6)]);
    const r = computeFlows(g, dataset);
    expect(eff(r, gen)).toBeCloseTo(100, 3);
    expect(r.perNode[gen.id]?.powerMW ?? 0).toBeCloseTo(75, 3);
    expect(r.totals.powerBalanceMW).toBeCloseTo(75, 3);
  });

  test("generator at half fuel produces half power", () => {
    resetIds();
    const fuel = planInput("Desc_Coal_C", 7.5);
    const gen = generator("Build_GeneratorCoal_C");
    const g = graph([fuel, gen], [belt(fuel, gen, 6)]);
    const r = computeFlows(g, dataset);
    expect(eff(r, gen)).toBeCloseTo(50, 2);
    expect(r.perNode[gen.id]?.powerMW ?? 0).toBeCloseTo(37.5, 2);
  });

  test("unfueled generator produces no power", () => {
    resetIds();
    // A Coal Generator with nothing connected to its fuel port must not report
    // full (or any) power — an unfueled generator converts nothing.
    const gen = generator("Build_GeneratorCoal_C");
    const g = graph([gen], []);
    const r = computeFlows(g, dataset);
    expect(eff(r, gen)).toBeCloseTo(0, 3);
    expect(r.perNode[gen.id]?.powerMW ?? 0).toBeCloseTo(0, 6);
    expect(r.totals.powerBalanceMW).toBeCloseTo(0, 6);
  });

  test("free sink: unconnected outputs drain freely and surface as unplanned surplus", () => {
    resetIds();
    // The user's exact incremental-planning scenario: miner -> splitter -> smelter
    // with the smelter's ingot output (and two splitter ports) left unconnected.
    // Under free-sink semantics the whole chain runs at 100%; undrained items show
    // up in totals as unplanned surplus instead of stalling the chain to 0.
    const miner = extractor("Build_MinerMk1_C", "Desc_OreIron_C"); // normal = 60/min
    const sp = splitter();
    const smelter = machine("Build_SmelterMk1_C", "Recipe_IronIngot_C"); // 30 -> 30
    const eA = belt(miner, sp, 1);
    const eB = belt(sp, smelter, 5, { sourceHandle: "out0" });
    const g = graph([miner, sp, smelter], [eA, eB]);
    const r = computeFlows(g, dataset);
    expect(eff(r, miner)).toBeCloseTo(100, 3);
    expect(eff(r, smelter)).toBeCloseTo(100, 3);
    expect(r.perEdge[eA.id]?.actualRatePerMinute).toBeCloseTo(60, 4);
    expect(r.perEdge[eB.id]?.actualRatePerMinute).toBeCloseTo(30, 4);
    expect(outRate(r, smelter, "Desc_IronIngot_C")).toBeCloseTo(30, 4);
    expect(r.diagnostics.bottlenecks).toHaveLength(0);
    const surplus = Object.fromEntries(
      r.totals.unplannedSurplus.map((s) => [s.itemClass, s.ratePerMinute]),
    );
    // dangling smelter output + ore vanishing at the splitter's free ports
    expect(surplus["Desc_IronIngot_C"]).toBeCloseTo(30, 4);
    expect(surplus["Desc_OreIron_C"]).toBeCloseTo(30, 4);
  });

  test("free sink: a lone extractor runs at 100% with its full rate as surplus", () => {
    resetIds();
    const miner = extractor("Build_MinerMk1_C", "Desc_OreIron_C");
    const g = graph([miner], []);
    const r = computeFlows(g, dataset);
    expect(eff(r, miner)).toBeCloseTo(100, 3);
    expect(outRate(r, miner, "Desc_OreIron_C")).toBeCloseTo(60, 4);
    const raw = r.totals.rawInputs.find((x) => x.itemClass === "Desc_OreIron_C");
    expect(raw?.ratePerMinute ?? 0).toBeCloseTo(60, 4);
    const sur = r.totals.unplannedSurplus.find(
      (x) => x.itemClass === "Desc_OreIron_C",
    );
    expect(sur?.ratePerMinute ?? 0).toBeCloseTo(60, 4);
    expect(r.diagnostics.bottlenecks).toHaveLength(0);
  });

  test("fluid loop with recycled water converges to 100%", () => {
    resetIds();
    const rubber = planInput("Desc_Rubber_C", 10);
    const extWater = planInput("Desc_Water_C", 8);
    const refinery = machine("Build_RefineryMk1_C", "Recipe_WaterLoop_C");
    const mg = merger();
    const plasticOut = planOutput("Desc_Plastic_C", 100);
    const waterBack = pipe(refinery, mg, 2, { sourceHandle: "outWater", targetHandle: "in1" });
    const g = graph(
      [rubber, extWater, refinery, mg, plasticOut],
      [
        belt(rubber, refinery, 6, { targetHandle: "inRubber" }),
        pipe(extWater, mg, 2, { targetHandle: "in0" }),
        pipe(mg, refinery, 2, { targetHandle: "inWater" }),
        belt(refinery, plasticOut, 6, { sourceHandle: "outPlastic" }),
        waterBack,
      ],
    );
    const r = computeFlows(g, dataset);
    expect(eff(r, refinery)).toBeCloseTo(100, 2);
    expect(outRate(r, refinery, "Desc_Plastic_C")).toBeCloseTo(10, 3);
    // recycled water leg carries the 2 m³/min the recipe returns; external 8 tops it
    // up to the 10 the recipe consumes (mass conserved around the loop)
    expect(r.perEdge[waterBack.id]?.actualRatePerMinute).toBeCloseTo(2, 3);
    expect(inRate(r, refinery, "Desc_Water_C")).toBeCloseTo(10, 3);
  });

  test("reports broken dataset references", () => {
    resetIds();
    const src = planInput("Desc_OreIron_C", 30);
    const bad = machine("Build_Nonexistent_C", "Recipe_Missing_C");
    const g = graph([src, bad], [belt(src, bad)]);
    const r = computeFlows(g, dataset);
    const kinds = r.diagnostics.brokenReferences.map((b) => b.kind);
    expect(kinds).toContain("building");
    expect(kinds).toContain("recipe");
    expect(r.diagnostics.brokenReferences.every((b) => b.nodeId === bad.id)).toBe(true);
  });

  test("does not hang on a self-referential cycle and stays bounded", () => {
    resetIds();
    // pathological: a merger feeding a splitter feeding back into the merger with
    // no producer — must converge to zero flow, not spin forever.
    const mg = merger();
    const sp = splitter();
    const g = graph(
      [mg, sp],
      [
        belt(mg, sp, 6),
        belt(sp, mg, 6, { sourceHandle: "out0", targetHandle: "in1" }),
      ],
    );
    const r = computeFlows(g, dataset);
    for (const e of Object.values(r.perEdge)) {
      expect(e.actualRatePerMinute).toBeCloseTo(0, 4);
    }
  });
});

void CLOSE;
