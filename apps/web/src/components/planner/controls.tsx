/**
 * Reusable node-editing controls, shared between the compact node cards and the
 * right-hand Inspector. Each is presentational: it takes the current value and an
 * onChange callback; callers wire these to the graph reducer. All controls carry
 * the `nodrag` class so interacting with them never drags the underlying node.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@satisfactory-tools/ui/components/select";
import { Slider } from "@satisfactory-tools/ui/components/slider";
import { Input } from "@satisfactory-tools/ui/components/input";
import { cn } from "@satisfactory-tools/ui/lib/utils";

export interface Option {
  value: string;
  label: string;
}

/** A minimal single-value select over string options. */
export function SimpleSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = "sm",
  disabled,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "default";
  disabled?: boolean;
}) {
  const items = options.map((o) => ({ value: o.value, label: o.label }));
  return (
    <Select
      value={value ?? ""}
      onValueChange={(v) => onValueChange(String(v))}
      items={items}
      disabled={disabled}
    >
      <SelectTrigger
        size={size}
        className={cn("nodrag w-full", className)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Clock-speed control: slider (1–250%) plus a numeric input. */
export function ClockSpeedControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const clamp = (n: number) => Math.min(250, Math.max(1, Math.round(n)));
  return (
    <div className="nodrag flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
      <Slider
        min={1}
        max={250}
        value={value}
        onValueChange={(v) => onChange(clamp(Array.isArray(v) ? (v[0] ?? value) : v))}
        className="flex-1"
      />
      <div className="flex items-center">
        <Input
          type="number"
          min={1}
          max={250}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="h-7 w-16 text-right text-xs tabular-nums"
        />
        <span className="pl-1 text-xs text-muted-foreground">%</span>
      </div>
    </div>
  );
}

/** Somersloop slot toggles: `slots` squares, filled up to `value`. */
export function SomersloopToggles({
  slots,
  value,
  onChange,
}: {
  slots: number;
  value: number;
  onChange: (value: number) => void;
}) {
  if (slots <= 0) return null;
  return (
    <div className="nodrag flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
      {Array.from({ length: slots }, (_, i) => {
        const active = i < value;
        return (
          <button
            key={i}
            type="button"
            aria-label={`Somersloop slot ${i + 1}`}
            aria-pressed={active}
            onClick={() => onChange(value === i + 1 ? i : i + 1)}
            className={cn(
              "size-5 border transition-colors",
              active
                ? "border-fuchsia-300 bg-fuchsia-500/80"
                : "border-border bg-muted/40 hover:bg-muted",
            )}
          />
        );
      })}
    </div>
  );
}

/** A plain rate input in items (or m³) per minute. */
export function RateInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="nodrag flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="h-7 w-24 text-right text-xs tabular-nums"
      />
      <span className="text-xs text-muted-foreground">/min</span>
    </div>
  );
}
