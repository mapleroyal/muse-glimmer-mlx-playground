import { describe, expect, it } from "vitest";

import {
  isAtScrollBottom,
  nextScrollFollowState,
  SCROLL_BOTTOM_THRESHOLD_PX,
} from "@/hooks/use-scroll-follow";

function scrollElement({ clientHeight = 200, scrollHeight = 800, scrollTop }) {
  return { clientHeight, scrollHeight, scrollTop };
}

describe("isAtScrollBottom", () => {
  it("uses a small boundary for fractional scroll positions", () => {
    expect(
      isAtScrollBottom(
        scrollElement({ scrollTop: 600 - SCROLL_BOTTOM_THRESHOLD_PX }),
      ),
    ).toBe(true);
    expect(
      isAtScrollBottom(
        scrollElement({ scrollTop: 599 - SCROLL_BOTTOM_THRESHOLD_PX }),
      ),
    ).toBe(false);
  });

  it("treats content that does not overflow as already at the bottom", () => {
    expect(
      isAtScrollBottom(
        scrollElement({ clientHeight: 300, scrollHeight: 200, scrollTop: 0 }),
      ),
    ).toBe(true);
  });
});

describe("nextScrollFollowState", () => {
  it("escapes follow mode as soon as an upward scroll leaves the boundary", () => {
    expect(
      nextScrollFollowState({
        atBottom: false,
        following: true,
        previousScrollTop: 600,
        scrollTop: 594,
      }),
    ).toBe(false);
  });

  it("does not mistake downward layout movement for upward user intent", () => {
    expect(
      nextScrollFollowState({
        atBottom: false,
        following: true,
        previousScrollTop: 420,
        scrollTop: 500,
      }),
    ).toBe(true);
  });

  it("ignores a stale programmatic event when content grows without movement", () => {
    expect(
      nextScrollFollowState({
        atBottom: false,
        following: true,
        previousScrollTop: 500,
        scrollTop: 500,
      }),
    ).toBe(true);
  });

  it("stays detached while streamed content grows without user movement", () => {
    expect(
      nextScrollFollowState({
        atBottom: false,
        following: false,
        previousScrollTop: 420,
        scrollTop: 420,
      }),
    ).toBe(false);
  });

  it("resumes only after a downward scroll reaches the bottom boundary", () => {
    expect(
      nextScrollFollowState({
        atBottom: false,
        following: false,
        previousScrollTop: 420,
        scrollTop: 500,
      }),
    ).toBe(false);
    expect(
      nextScrollFollowState({
        atBottom: true,
        following: false,
        previousScrollTop: 590,
        scrollTop: 597,
      }),
    ).toBe(true);
  });

  it("does not mistake a layout clamp at the bottom for user escape", () => {
    expect(
      nextScrollFollowState({
        atBottom: true,
        following: true,
        previousScrollTop: 600,
        scrollTop: 480,
      }),
    ).toBe(true);
  });

  it("does not reattach a paused view when layout changes place it at bottom", () => {
    expect(
      nextScrollFollowState({
        atBottom: true,
        following: false,
        previousScrollTop: 600,
        scrollTop: 480,
      }),
    ).toBe(false);
  });
});
