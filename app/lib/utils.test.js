import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("merges conflicting Tailwind classes and keeps non-conflicts", () => {
    expect(cn("px-2 py-1", "px-4", "text-sm")).toBe("py-1 px-4 text-sm");
  });

  it("merges semantic typography utilities with Tailwind font sizes", () => {
    expect(cn("text-sm font-medium leading-tight", "text-body-sm")).toBe(
      "text-body-sm",
    );
    expect(cn("text-body-sm", "text-sm")).toBe("text-sm");
    expect(cn("text-title-lg", "text-headline-sm")).toBe("text-headline-sm");
  });

  it("keeps semantic typography and text colors independent", () => {
    expect(cn("text-body-md", "text-muted-foreground")).toBe(
      "text-body-md text-muted-foreground",
    );
  });
});
