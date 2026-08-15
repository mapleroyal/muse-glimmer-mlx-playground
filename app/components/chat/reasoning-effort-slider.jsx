import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

export function ReasoningEffortSlider({
  className,
  id,
  labelledBy,
  levels,
  onValueChange,
  selectedIndex,
}) {
  const lastIndex = Math.max(1, levels.length - 1);

  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex h-8 w-full touch-none items-center select-none data-disabled:opacity-50",
        className,
      )}
      max={levels.length - 1}
      min={0}
      step={1}
      value={[selectedIndex]}
      onValueChange={([nextIndex]) => onValueChange(nextIndex)}
    >
      <SliderPrimitive.Track
        data-corner-shape="round"
        className="relative h-4 w-full grow overflow-hidden rounded-full bg-foreground/15 shadow-inner ring-1 ring-foreground/5"
      >
        <SliderPrimitive.Range
          data-corner-shape="round"
          className="absolute h-full rounded-full bg-chart-2"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-0"
        >
          {levels.map((level, index) =>
            index === selectedIndex ? null : (
              <span
                key={level.value}
                data-corner-shape="round"
                className={cn(
                  "absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/5",
                  index < selectedIndex ? "bg-white/35" : "bg-foreground/25",
                )}
                style={{ left: `${(index / lastIndex) * 100}%` }}
              />
            ),
          )}
        </span>
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        id={id}
        aria-labelledby={labelledBy}
        aria-valuetext={levels[selectedIndex]?.label}
        data-corner-shape="round"
        className="relative z-20 block size-6 shrink-0 rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/0.28)] ring-1 ring-black/10 transition-[transform,box-shadow] select-none hover:scale-105 focus-visible:scale-105 focus-visible:ring-4 focus-visible:ring-chart-2/35 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
      />
    </SliderPrimitive.Root>
  );
}
