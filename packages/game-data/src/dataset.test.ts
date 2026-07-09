/**
 * Sanity tests over the generated 1.2 Game Dataset. Run with `bun test`.
 * These assert known-good in-game values so a bad re-parse fails loudly.
 */

import { describe, expect, test } from "bun:test";

import { loadDataset, listDatasetVersions } from "./registry";
import { isExtractor, isGenerator, isManufacturer } from "./lookup";

const ds = await loadDataset("1.2");

describe("dataset registry", () => {
  test("1.2 is listed on disk", async () => {
    expect(await listDatasetVersions()).toContain("1.2");
  });

  test("index is populated", () => {
    expect(ds.version).toBe("1.2");
    expect(Object.keys(ds.items).length).toBeGreaterThan(100);
    expect(Object.keys(ds.recipes).length).toBeGreaterThan(200);
  });
});

describe("iron ingot recipe", () => {
  const r = ds.recipes["Recipe_IngotIron_C"];

  test("smelts 30 ore/min into 30 ingot/min in the Smelter", () => {
    expect(r).toBeDefined();
    expect(ds.buildings[r!.producedIn]?.displayName).toBe("Smelter");
    expect(r!.durationSeconds).toBe(2);
    expect(r!.ingredients).toHaveLength(1);
    expect(r!.ingredients[0]).toMatchObject({
      item: "Desc_OreIron_C",
      ratePerMinute: 30,
    });
    expect(r!.products[0]).toMatchObject({
      item: "Desc_IronIngot_C",
      ratePerMinute: 30,
    });
    expect(r!.isAlternate).toBe(false);
  });
});

describe("belt & pipe capacities", () => {
  test("Belt Mk5 = 780/min, Mk6 = 1200/min", () => {
    expect(ds.beltCapacity[5]).toBe(780);
    expect(ds.beltCapacity[6]).toBe(1200);
  });
  test("Pipe Mk1 = 300, Mk2 = 600 m³/min", () => {
    expect(ds.pipeCapacity[1]).toBe(300);
    expect(ds.pipeCapacity[2]).toBe(600);
  });
});

describe("buildings", () => {
  test("Constructor: 4 MW base power, 1 Somersloop slot", () => {
    const b = ds.buildings["Build_ConstructorMk1_C"];
    expect(b && isManufacturer(b)).toBe(true);
    if (b && isManufacturer(b)) {
      expect(b.basePowerMW).toBe(4);
      expect(b.somersloopSlots).toBe(1);
    }
  });

  test("Miners Mk1-3 extract 60/120/240 per min at Normal purity", () => {
    for (const [cls, rate] of [
      ["Build_MinerMk1_C", 60],
      ["Build_MinerMk2_C", 120],
      ["Build_MinerMk3_C", 240],
    ] as const) {
      const b = ds.buildings[cls];
      expect(b && isExtractor(b)).toBe(true);
      if (b && isExtractor(b)) expect(b.baseRatePerMinute).toBe(rate);
    }
  });

  test("Water Extractor pulls 120 m³/min", () => {
    const b = ds.buildings["Build_WaterPump_C"];
    expect(b && isExtractor(b) && b.baseRatePerMinute).toBe(120);
  });

  test("Coal Generator: 75 MW, 45 m³/min water", () => {
    const b = ds.buildings["Build_GeneratorCoal_C"];
    expect(b && isGenerator(b)).toBe(true);
    if (b && isGenerator(b)) {
      expect(b.powerProductionMW).toBe(75);
      expect(b.supplementalResource).toBe("Desc_Water_C");
      expect(b.supplementalRatePerMinute).toBe(45);
    }
  });

  test("Nuclear Power Plant: 2500 MW, 240 m³ water, 10 waste/min", () => {
    const b = ds.buildings["Build_GeneratorNuclear_C"];
    expect(b && isGenerator(b)).toBe(true);
    if (b && isGenerator(b)) {
      expect(b.powerProductionMW).toBe(2500);
      expect(b.supplementalRatePerMinute).toBe(240);
      expect(b.byproduct).toEqual({
        item: "Desc_NuclearWaste_C",
        ratePerMinute: 10,
      });
    }
  });
});

describe("alternate recipe detection", () => {
  test("at least one alternate exists and is flagged", () => {
    const alts = Object.values(ds.recipes).filter((r) => r.isAlternate);
    expect(alts.length).toBeGreaterThan(50);
    expect(alts.every((r) => r.className.includes("Alternate") || r.displayName.startsWith("Alternate:"))).toBe(true);
  });
});
