/**
 * Renders a node's input/output React Flow handles, evenly spaced on the left
 * (targets) and right (sources) edges. Handle color encodes the medium: orange
 * for Belts (solids), cyan for Pipes (fluids), neutral for logistics passthrough.
 */

import { cn } from "@satisfactory-tools/ui/lib/utils";
import { Handle, Position } from "@xyflow/react";

import type { PortSpec } from "../ports";
import { mediumForForm } from "../ports";

function mediumClass(form: PortSpec["form"]): string {
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
  inputs,
  outputs,
}: {
  inputs: PortSpec[];
  outputs: PortSpec[];
}) {
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
