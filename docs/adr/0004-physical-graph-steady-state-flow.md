# The Plan graph is physical, and flows are computed at steady state

A Plan maps 1:1 to what would be built in-game: Splitters and Mergers are first-class nodes (flow never splits implicitly at machine ports), and every connection is a Belt or Pipe with an Mk variant and enforced capacity. Flow semantics are steady-state equilibrium with back-pressure — each Machine runs at the Efficiency its inputs can sustain and its outputs can drain, which is what the game itself converges to. Alternatives rejected: abstract edges with implicit splitting (simpler graph, but "splits" stop being plannable and the plan no longer maps to a build), and time-domain simulation (buffers filling over time — high cost, marginal planning value).

## Consequences

- Plans are more verbose than in abstract planners (a real 2-to-3 belt manifold is drawn as actual splitter nodes) — this is deliberate.
- Vehicles (trains/drones/trucks) are out of scope; Plan Input/Output nodes represent factory boundaries instead.
- Computing Efficiency is a fixed-point problem over the graph (splitter overflow redistribution, back-pressure), not a single forward pass.

## Amendment (2026-07-09): unconnected output ports are free sinks

Back-pressure only applies on connected paths. An output port with nothing attached drains freely: it never gates a Machine's Efficiency, and whatever drains that way is reported in the Plan totals as unplanned surplus. A Splitter with a spare port (or a Merger with no output connected) likewise pulls at full connection capacity, with connected branches keeping priority and only the excess free-sinking. Rationale: strict back-pressure on dangling ports stalled every chain to 0% while a Plan was being built incrementally (a miner→smelter chain read 0/min until its final output was routed), which fights the tool's purpose. The alternative — keeping strict semantics and asking users to terminate every chain with a Plan Output — was rejected as busywork; declared Plan Outputs remain the way to express real demand targets.

## Amendment (2026-07-12): a Splitter free-sinks only when fully unconnected

Supersedes the Splitter clause above. A Splitter free-sinks (pulls at full connection capacity) only while it has **no** output connected — matching the Merger rule. As soon as at least one output is wired, spare ports stop free-sinking and the Splitter pulls only what its connected branches demand, back-pressuring its source. Rationale: the prior rule made a spare port silently drain a source at full rate (e.g. a 60/min miner → Splitter → one 30/min Smelter reported the miner at 100% with 30/min of ore vanishing as surplus), which read as a bug rather than incremental-planning liveness. Dangling *machine* output ports still free-sink, so a chain whose final output isn't yet routed keeps running live instead of stalling to 0% — the original amendment's purpose is preserved. A back-pressured producer surfaces as a bottleneck ("Output … cannot drain"), which is the desired "why am I below 100%?" signal.

## Amendment (2026-07-12): an undersized belt throttles the extractor's Efficiency

An Extractor's Efficiency is measured against its *true* nominal rate (base × purity × clock), not against its belt capacity. If that rate exceeds what the connected Belt/Pipe can carry, the excess is throttled and the Extractor runs below 100% (e.g. a pure-node miner making 120/min on a Mk1 belt carrying 60 runs at 50%), with the connection flagged over capacity. Previously the Extractor's nominal output was silently clamped to its belt capacity, so a belt-limited miner read a misleading 100%. This is the same principle as the back-pressure amendment above: a producer limited by a downstream constraint should show that as reduced Efficiency, not hide it.

## Amendment (2026-07-12): logistics nodes never free-sink

Supersedes the Splitter/Merger free-sink clauses in the two amendments above. A Splitter or Merger *only routes* — it never drains freely. It pulls exactly what its connected outputs demand; with **no** output wired that demand is 0, so a dead-end logistics node back-pressures its source to 0% (the material has nowhere to go). Only unwired **machine output ports** still free-sink, which is what keeps an in-progress production chain live (a just-placed Smelter with an unrouted ingot output still reads 100%). Rationale: the previous rule (a fully-unconnected Splitter/Merger free-sinks) produced a confusing discontinuity — `miner → splitter → dead-end splitter` read 100%, yet wiring a real 30/min consumer onto that splitter *dropped* the miner to 50%. Making logistics purely a router removes that: connecting a consumer can only ever raise Efficiency, never lower it, and a dead-end chain honestly reads 0% with an "output cannot drain" bottleneck.
