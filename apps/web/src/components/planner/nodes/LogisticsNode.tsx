/**
 * Compact Splitter / Merger nodes. These are first-class logistics buildings
 * (ADR-0004): flow only splits or merges where one is placed. Rendered small,
 * with fixed ports and no per-node controls.
 */

import { getBuilding } from "@satisfactory-tools/game-data";
import { cn } from "@satisfactory-tools/ui/lib/utils";
import type { NodeProps } from "@xyflow/react";
import { Split, Merge } from "lucide-react";

import { usePlanner } from "../PlannerContext";
import { inputPorts, outputPorts } from "../ports";
import { PortHandles } from "./PortHandles";

export function SplitterNode({ id, selected }: NodeProps) {
  return <LogisticsNode id={id} selected={selected} kind="splitter" />;
}

export function MergerNode({ id, selected }: NodeProps) {
  return <LogisticsNode id={id} selected={selected} kind="merger" />;
}

function LogisticsNode({
  id,
  selected,
  kind,
}: {
  id: string;
  selected: NodeProps["selected"];
  kind: "splitter" | "merger";
}) {
  const { graph, dataset, highlightedNodeIds, brokenNodeIds } = usePlanner();
  const node = graph.nodes.find((n) => n.id === id);
  if (!node || node.kind !== kind) return null;

  const building = getBuilding(dataset, node.buildingClass);
  const Icon = kind === "splitter" ? Split : Merge;

  return (
    <div
      className={cn(
        "relative flex h-14 w-14 items-center justify-center border bg-card text-card-foreground shadow-sm",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
        brokenNodeIds.has(id) && "border-destructive ring-1 ring-destructive",
        highlightedNodeIds.has(id) && "ring-2 ring-destructive animate-pulse",
      )}
      title={building?.displayName ?? kind}
    >
      <Icon className="size-6 text-primary" />
      <PortHandles
        inputs={inputPorts(node, dataset)}
        outputs={outputPorts(node, dataset)}
      />
    </div>
  );
}
