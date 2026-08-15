import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const typeStyles = [
  "text-display-lg",
  "text-display-md",
  "text-display-sm",
  "text-headline-lg",
  "text-headline-md",
  "text-headline-sm",
  "text-title-lg",
  "text-title-md",
  "text-title-sm",
  "text-body-lg",
  "text-body-md",
  "text-body-sm",
  "text-label-lg",
  "text-label-md",
  "text-label-sm",
];

const mergeTailwindClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      "type-style": typeStyles,
    },
    conflictingClassGroups: {
      "type-style": ["font-size", "font-weight", "leading", "tracking"],
      "font-size": ["type-style"],
    },
  },
});

export function cn(...inputs) {
  return mergeTailwindClasses(clsx(inputs));
}
