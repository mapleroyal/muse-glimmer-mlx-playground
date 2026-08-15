import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Progress({ className, value = 0, indeterminate = false, ...props }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={indeterminate ? null : value}
      className={cn(
        "relative flex h-3 w-full items-center overflow-x-hidden rounded-4xl bg-muted",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "size-full flex-1 bg-primary transition-transform duration-300 data-[state=indeterminate]:w-1/2 data-[state=indeterminate]:animate-[progress-indeterminate_1.2s_ease-in-out_infinite]",
        )}
        style={
          indeterminate
            ? undefined
            : { transform: `translateX(-${100 - value}%)` }
        }
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
