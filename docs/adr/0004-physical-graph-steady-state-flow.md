# The Plan graph is physical, and flows are computed at steady state

A Plan maps 1:1 to what would be built in-game: Splitters and Mergers are first-class nodes (flow never splits implicitly at machine ports), and every connection is a Belt or Pipe with an Mk variant and enforced capacity. Flow semantics are steady-state equilibrium with back-pressure — each Machine runs at the Efficiency its inputs can sustain and its outputs can drain, which is what the game itself converges to. Alternatives rejected: abstract edges with implicit splitting (simpler graph, but "splits" stop being plannable and the plan no longer maps to a build), and time-domain simulation (buffers filling over time — high cost, marginal planning value).

## Consequences

- Plans are more verbose than in abstract planners (a real 2-to-3 belt manifold is drawn as actual splitter nodes) — this is deliberate.
- Vehicles (trains/drones/trucks) are out of scope; Plan Input/Output nodes represent factory boundaries instead.
- Computing Efficiency is a fixed-point problem over the graph (splitter overflow redistribution, back-pressure), not a single forward pass.

## Amendment (2026-07-09): unconnected output ports are free sinks

Back-pressure only applies on connected paths. An output port with nothing attached drains freely: it never gates a Machine's Efficiency, and whatever drains that way is reported in the Plan totals as unplanned surplus. A Splitter with a spare port (or a Merger with no output connected) likewise pulls at full connection capacity, with connected branches keeping priority and only the excess free-sinking. Rationale: strict back-pressure on dangling ports stalled every chain to 0% while a Plan was being built incrementally (a miner→smelter chain read 0/min until its final output was routed), which fights the tool's purpose. The alternative — keeping strict semantics and asking users to terminate every chain with a Plan Output — was rejected as busywork; declared Plan Outputs remain the way to express real demand targets.
