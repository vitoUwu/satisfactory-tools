import { describe, expect, test } from "bun:test";

import type { PlanGraph } from "@satisfactory-tools/planner-engine";
import { PLAN_GRAPH_SCHEMA_VERSION } from "@satisfactory-tools/planner-engine";

import {
  deserializePlanGraph,
  deserializeRecipePreferences,
  emptyPlanGraph,
  serializePlanGraph,
  serializeRecipePreferences,
} from "./plan-serialization";

const sampleGraph: PlanGraph = {
  schemaVersion: PLAN_GRAPH_SCHEMA_VERSION,
  nodes: [
    {
      kind: "extractor",
      id: "n1",
      position: { x: 0, y: 0 },
      buildingClass: "Build_MinerMk1_C",
      resourceClass: "Desc_OreIron_C",
      mk: 1,
      clockSpeed: 100,
      purity: "normal",
    },
    {
      kind: "machine",
      id: "n2",
      position: { x: 320, y: 40 },
      buildingClass: "Build_SmelterMk1_C",
      recipeClass: "Recipe_IngotIron_C",
      clockSpeed: 250,
      somersloops: 1,
    },
    {
      kind: "planOutput",
      id: "n3",
      position: { x: 640, y: 40 },
      itemClass: "Desc_IronIngot_C",
      ratePerMinute: 30,
    },
  ],
  edges: [
    {
      id: "e1",
      kind: "belt",
      mk: 5,
      source: "n1",
      sourceHandle: "out",
      target: "n2",
      targetHandle: "in",
    },
  ],
};

describe("plan graph serialization", () => {
  test("round-trips a populated graph without loss", () => {
    const restored = deserializePlanGraph(serializePlanGraph(sampleGraph));
    expect(restored).toEqual(sampleGraph);
  });

  test("round-trips an empty graph", () => {
    const empty = emptyPlanGraph();
    expect(deserializePlanGraph(serializePlanGraph(empty))).toEqual(empty);
    expect(empty.nodes).toHaveLength(0);
    expect(empty.edges).toHaveLength(0);
  });

  test("rejects a graph with an unknown node kind", () => {
    const bad = JSON.stringify({
      schemaVersion: PLAN_GRAPH_SCHEMA_VERSION,
      nodes: [{ kind: "teleporter", id: "x", position: { x: 0, y: 0 } }],
      edges: [],
    });
    expect(() => deserializePlanGraph(bad)).toThrow();
  });

  test("rejects a clock speed outside 1–250", () => {
    const bad = JSON.stringify({
      ...sampleGraph,
      nodes: [{ ...sampleGraph.nodes[1], clockSpeed: 300 }],
    });
    expect(() => deserializePlanGraph(bad)).toThrow();
  });
});

describe("recipe preferences serialization", () => {
  test("round-trips a preferences map", () => {
    const prefs = {
      Desc_IronIngot_C: "Recipe_IngotIron_C",
      Desc_Wire_C: "Recipe_Alternate_Wire_1_C",
    };
    expect(
      deserializeRecipePreferences(serializeRecipePreferences(prefs)),
    ).toEqual(prefs);
  });

  test("round-trips an empty preferences map", () => {
    expect(deserializeRecipePreferences(serializeRecipePreferences({}))).toEqual(
      {},
    );
  });
});
