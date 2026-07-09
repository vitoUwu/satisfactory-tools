# Satisfactory Tools

A personal suite of tools for planning Satisfactory factories. The first tool is the Planner: an interactive, animated graph editor where factories are laid out as machines and logistics connected by belts and pipes, with live throughput and power calculations.

## Language

### Planning

**Planner**:
The interactive graph editor tool for designing a factory. The first tool in the suite.

**Plan**:
A named, saved factory graph owned by the user. Created, renamed, duplicated, and deleted independently; autosaved while editing.
_Avoid_: Blueprint (in-game term for a buildable object), project, design

**Solver Assist**:
A helper that, given a node, auto-expands its ingredient chain into the Plan as new nodes and connections. Assists the graph; never replaces manual editing.
_Avoid_: Calculator, optimizer

### Graph

**Machine**:
A production or extraction building placed as a node in a Plan (e.g. Constructor, Assembler, Refinery, Miner). Has a selected recipe, an Mk variant where applicable, a clock speed, and Somersloop slots where applicable.
_Avoid_: Building (ambiguous with logistics), factory

**Extractor**:
A Machine that pulls raw resources from the world (Miner, Water Extractor, Oil Extractor, Resource Well). Miners sit on a resource node with a chosen Purity.

**Purity**:
The richness of the resource node an Extractor sits on — Impure (×0.5), Normal (×1), or Pure (×2). Multiplies extraction rate.

**Plan Input / Plan Output**:
Abstract boundary nodes declaring that items enter or leave the Plan at a given rate (e.g. "480 Iron Ingots/min arrives here"), without modeling where they come from or go. Enables planning partial factories.
_Avoid_: Import/export, source/sink

**Splitter / Merger**:
Logistics buildings placed as first-class nodes in a Plan, exactly as they would be built in-game. Flow does not split or merge implicitly at machine ports.

**Belt / Pipe**:
A connection (edge) between two nodes. Carries solid items (Belt) or fluids (Pipe). Has an Mk variant that sets its maximum capacity; a connection carrying more than its capacity is over capacity and flagged.
_Avoid_: Edge, link, wire

**Mk Variant**:
The mark/tier of a specific placed building or connection (Miner Mk1–3, Belt Mk1–6, Pipe Mk1–2). Selected per node/connection; changes extraction rates and capacities.
_Avoid_: Level, tier (reserved for milestone tiers)

**Clock Speed**:
Per-machine production speed setting, 1%–250%. Scales throughput linearly and power draw super-linearly (game's real power curve).
_Avoid_: Machine power %, overclock (that's only the >100% case)

**Somersloop**:
Production amplifier slotted into a machine. A fully slotted machine doubles output and quadruples power draw.
_Avoid_: Amplifier

**Power Balance**:
The net MW of a Plan: power produced by Generators minus power drawn by all other machines, clock-speed and Somersloop adjusted. Power is one global pool per Plan; there is no grid topology.

**Generator**:
A Machine that consumes fuel items via normal flow and contributes MW to the Power Balance (e.g. Coal Generator, Fuel Generator, Nuclear Power Plant).

### Data

**Game Dataset**:
The static, typed set of items, recipes, and buildings parsed from the game's official Docs.json dump, versioned to a specific game release (currently 1.2). The single source of truth for all game data in the app.
_Avoid_: Wiki data, game files
