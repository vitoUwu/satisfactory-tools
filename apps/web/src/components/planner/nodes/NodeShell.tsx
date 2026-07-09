/**
 * Common frame for every Planner node: a dark-industrial card with a titled
 * header (icon + name + optional efficiency badge / power draw), selection ring,
 * and a bottleneck highlight pulse. Node-specific controls are passed as children.
 */

import { Badge } from "@satisfactory-tools/ui/components/badge";
import { cn } from "@satisfactory-tools/ui/lib/utils";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { fmtEfficiency, fmtPower } from "../format";
import { ItemIcon } from "../ItemIcon";

export function NodeShell({
  iconSlug,
  title,
  subtitle,
  efficiency,
  powerMW,
  selected,
  highlighted,
  broken,
  accent,
  children,
  width = 240,
}: {
  iconSlug?: string;
  title: string;
  subtitle?: string;
  efficiency?: number;
  powerMW?: number;
  selected?: boolean;
  highlighted?: boolean;
  /** The node references something missing from the pinned Game Dataset. */
  broken?: boolean;
  accent?: "primary" | "cyan" | "muted";
  children?: ReactNode;
  width?: number;
}) {
  const accentBar =
    accent === "cyan"
      ? "bg-cyan-400"
      : accent === "muted"
        ? "bg-muted-foreground"
        : "bg-primary";

  const effTone =
    efficiency === undefined
      ? "secondary"
      : efficiency >= 99.5
        ? "default"
        : "destructive";

  return (
    <div
      style={{ width }}
      className={cn(
        "relative border bg-card text-card-foreground shadow-sm transition-shadow",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
        broken && "border-destructive ring-1 ring-destructive",
        highlighted && "ring-2 ring-destructive animate-pulse",
      )}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1", broken ? "bg-destructive" : accentBar)} />
      {broken && (
        <div className="flex items-center gap-1 border-b border-destructive/50 bg-destructive/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-destructive">
          <AlertTriangle className="size-3 shrink-0" /> Not in dataset
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 pl-3">
        {iconSlug !== undefined && (
          <ItemIcon slug={iconSlug} alt={title} className="size-6 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold uppercase tracking-wide">
            {title}
          </div>
          {subtitle && (
            <div className="truncate text-[10px] text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        {efficiency !== undefined && (
          <Badge variant={effTone} className="shrink-0 tabular-nums">
            {fmtEfficiency(efficiency)}
          </Badge>
        )}
      </div>
      {children && <div className="px-3 py-2">{children}</div>}
      {powerMW !== undefined && (
        <div className="border-t border-border px-3 py-1 text-[10px] tabular-nums text-muted-foreground">
          {fmtPower(powerMW)}
        </div>
      )}
    </div>
  );
}
