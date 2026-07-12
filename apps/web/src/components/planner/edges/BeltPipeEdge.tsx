/**
 * Custom Belt / Pipe edge. Draws a bezier connection with animated dashes flowing
 * from source to target, a mid-edge label showing actual / max rate plus an Mk
 * selector that sets the connection's capacity. Turns red when over capacity.
 */

import {
  BELT_CAPACITY_PER_MINUTE,
  PIPE_CAPACITY_PER_MINUTE,
} from "@satisfactory-tools/game-data";
import type { BeltMk, PipeMk } from "@satisfactory-tools/game-data";
import { cn } from "@satisfactory-tools/ui/lib/utils";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";

import { SimpleSelect } from "../controls";
import { fmtRate } from "../format";
import { usePlanner } from "../PlannerContext";

export function BeltPipeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const { graph, dispatch, flow } = usePlanner();
  const edge = graph.edges.find((e) => e.id === id);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  if (!edge) {
    return <BaseEdge id={id} path={path} />;
  }

  const edgeFlow = flow?.perEdge[id];
  const over = edgeFlow?.overCapacity ?? false;
  const isPipe = edge.kind === "pipe";

  const mkOptions = isPipe
    ? (Object.keys(PIPE_CAPACITY_PER_MINUTE) as unknown as PipeMk[]).map((mk) => ({
        value: String(mk),
        label: `Pipe Mk${mk}`,
      }))
    : (Object.keys(BELT_CAPACITY_PER_MINUTE) as unknown as BeltMk[]).map((mk) => ({
        value: String(mk),
        label: `Belt Mk${mk}`,
      }));

  const capacity = isPipe
    ? PIPE_CAPACITY_PER_MINUTE[edge.mk as PipeMk]
    : BELT_CAPACITY_PER_MINUTE[edge.mk as BeltMk];

  const stroke = over
    ? "var(--destructive)"
    : isPipe
      ? "var(--color-cyan-400, #22d3ee)"
      : "var(--primary)";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: "6 4",
        }}
        className="animate-[dashdraw_0.5s_linear_infinite]"
      />
      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          className={cn(
            "group nodrag nopan pointer-events-auto absolute flex items-center gap-1 border bg-card/95 px-1.5 py-0.5 text-[10px] shadow-sm",
            over ? "border-destructive text-destructive" : "border-border",
          )}
        >
          <span className="tabular-nums">
            {edgeFlow ? fmtRate(edgeFlow.actualRatePerMinute) : "—"} /{" "}
            {fmtRate(capacity ?? 0)}
          </span>
          <SimpleSelect
            value={String(edge.mk)}
            onValueChange={(v) =>
              dispatch({
                type: "updateEdge",
                id,
                patch: { mk: Number(v) as BeltMk | PipeMk },
              })
            }
            options={mkOptions}
            className="h-6 w-24"
          />
          <button
            type="button"
            aria-label="Disconnect"
            className="flex size-5 shrink-0 items-center justify-center border border-transparent text-muted-foreground opacity-0 transition hover:border-destructive hover:text-destructive group-hover:opacity-100"
            onClick={() => dispatch({ type: "removeEdge", id })}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
