/**
 * Bottom totals bar: Power Balance (produced / consumed / net MW), raw inputs,
 * net outputs, unplanned surplus (free-sunk production), and the bottleneck
 * list. Hovering a bottleneck highlights the nodes it implicates on the canvas.
 */

import { getItem } from "@satisfactory-tools/game-data";
import { cn } from "@satisfactory-tools/ui/lib/utils";
import { AlertTriangle, Zap } from "lucide-react";
import { useMemo } from "react";

import { fmtRate } from "./format";
import { ItemIcon } from "./ItemIcon";
import { usePlanner } from "./PlannerContext";

export function TotalsBar() {
  const { flow, flowError, dataset, setHoveredBottleneck } = usePlanner();

  const power = useMemo(() => {
    if (!flow) return { produced: 0, consumed: 0, net: 0 };
    let produced = 0;
    let consumed = 0;
    for (const nf of Object.values(flow.perNode)) {
      if (nf.powerMW >= 0) produced += nf.powerMW;
      else consumed += -nf.powerMW;
    }
    return { produced, consumed, net: flow.totals.powerBalanceMW };
  }, [flow]);

  return (
    <div className="flex h-full items-stretch gap-4 overflow-x-auto border-t border-border bg-sidebar px-4 py-2 text-xs">
      <section className="flex min-w-52 flex-col">
        <div className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wider text-muted-foreground">
          <Zap className="size-3.5 text-primary" /> Power Balance
        </div>
        {flow ? (
          <div className="flex flex-col gap-0.5 tabular-nums">
            <Row label="Produced" value={`${fmtRate(power.produced)} MW`} />
            <Row label="Consumed" value={`${fmtRate(power.consumed)} MW`} />
            <Row
              label="Net"
              value={`${power.net >= 0 ? "+" : ""}${fmtRate(power.net)} MW`}
              tone={power.net >= 0 ? "ok" : "bad"}
            />
          </div>
        ) : (
          <Placeholder error={flowError} />
        )}
      </section>

      <Divider />

      <section className="flex min-w-48 flex-col">
        <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
          Raw Inputs
        </div>
        {flow ? (
          <RateItems rates={flow.totals.rawInputs} dataset={dataset} />
        ) : (
          <Placeholder error={flowError} />
        )}
      </section>

      <Divider />

      <section className="flex min-w-48 flex-col">
        <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
          Net Outputs
        </div>
        {flow ? (
          <RateItems rates={flow.totals.netOutputs} dataset={dataset} />
        ) : (
          <Placeholder error={flowError} />
        )}
      </section>

      {flow && flow.totals.unplannedSurplus.length > 0 && (
        <>
          <Divider />
          <section className="flex min-w-48 flex-col">
            <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
              Unplanned Surplus
            </div>
            <RateItems rates={flow.totals.unplannedSurplus} dataset={dataset} />
          </section>
        </>
      )}

      {flow && flow.diagnostics.brokenReferences.length > 0 && (
        <>
          <Divider />
          <section className="flex min-w-56 flex-col">
            <div className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wider text-destructive">
              <AlertTriangle className="size-3.5" /> Broken References
            </div>
            <ul className="flex flex-col gap-0.5">
              {flow.diagnostics.brokenReferences.map((b, i) => (
                <li
                  key={i}
                  onMouseEnter={() =>
                    setHoveredBottleneck({ nodeId: b.nodeId, reason: b.message })
                  }
                  onMouseLeave={() => setHoveredBottleneck(null)}
                  className="cursor-default border border-transparent px-1 text-destructive hover:border-destructive/50 hover:bg-destructive/10"
                >
                  {b.message}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <Divider />

      <section className="flex min-w-56 flex-1 flex-col">
        <div className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wider text-muted-foreground">
          <AlertTriangle className="size-3.5 text-destructive" /> Bottlenecks
        </div>
        {flow ? (
          flow.diagnostics.bottlenecks.length === 0 ? (
            <span className="text-muted-foreground">None — running clean.</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {flow.diagnostics.bottlenecks.map((b, i) => (
                <li
                  key={i}
                  onMouseEnter={() => setHoveredBottleneck(b)}
                  onMouseLeave={() => setHoveredBottleneck(null)}
                  className="cursor-default border border-transparent px-1 text-destructive hover:border-destructive/50 hover:bg-destructive/10"
                >
                  {b.reason}
                </li>
              ))}
            </ul>
          )
        ) : (
          <Placeholder error={flowError} />
        )}
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "bad";
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          tone === "ok" && "text-primary",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function RateItems({
  rates,
  dataset,
}: {
  rates: { itemClass: string; ratePerMinute: number }[];
  dataset: ReturnType<typeof usePlanner>["dataset"];
}) {
  if (rates.length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {rates.map((r) => (
        <li key={r.itemClass} className="flex items-center gap-1.5">
          <ItemIcon slug={r.itemClass} className="size-4 shrink-0" />
          <span className="flex-1 truncate">
            {getItem(dataset, r.itemClass)?.displayName ?? r.itemClass}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {fmtRate(r.ratePerMinute)}/min
          </span>
        </li>
      ))}
    </ul>
  );
}

function Divider() {
  return <div className="w-px shrink-0 bg-border" />;
}

function Placeholder({ error }: { error: string | null }) {
  return (
    <span className="text-muted-foreground">
      {error ? "Flow unavailable" : "Computing…"}
    </span>
  );
}
