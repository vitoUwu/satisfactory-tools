/**
 * Renders a node's input/output React Flow handles, evenly spaced on the left
 * (targets) and right (sources) edges. Handle color encodes the medium: orange
 * for Belts (solids), cyan for Pipes (fluids), neutral for logistics passthrough.
 */

import { cn } from "@satisfactory-tools/ui/lib/utils";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";

import type { PortSpec } from "../ports";
import { mediumForForm } from "../ports";

export function mediumClass(form: PortSpec["form"]): string {
  const medium = mediumForForm(form);
  if (medium === "pipe") return "!bg-cyan-400 !border-cyan-200";
  if (medium === "belt") return "!bg-primary !border-primary-foreground";
  return "!bg-muted-foreground !border-border";
}

function spread(count: number, index: number): string {
  // Distribute handles as fractions of the node height.
  return `${((index + 1) / (count + 1)) * 100}%`;
}

export function PortHandles({
  nodeId,
  inputs,
  outputs,
}: {
  nodeId: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
}) {
  // React Flow caches each node's handle bounds; when the port set changes
  // (e.g. a machine's recipe is picked, adding/renaming handles) it must be told
  // to re-measure, or edges to the new handles silently fail to render until a
  // full remount (the "connected after refresh" desync).
  const updateNodeInternals = useUpdateNodeInternals();
  const signature = `${inputs.map((p) => p.id).join(",")}|${outputs
    .map((p) => p.id)
    .join(",")}`;
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, signature, updateNodeInternals]);

  return (
    <>
      {inputs.map((p, i) => (
        <Handle
          key={p.id}
          id={p.id}
          type="target"
          position={Position.Left}
          title={p.label}
          style={{ top: spread(inputs.length, i) }}
          className={cn("!size-3 !rounded-none", mediumClass(p.form))}
        />
      ))}
      {outputs.map((p, i) => (
        <Handle
          key={p.id}
          id={p.id}
          type="source"
          position={Position.Right}
          title={p.label}
          style={{ top: spread(outputs.length, i) }}
          className={cn("!size-3 !rounded-none", mediumClass(p.form))}
        />
      ))}
    </>
  );
}
