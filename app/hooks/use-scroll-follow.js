import * as React from "react";

export const SCROLL_BOTTOM_THRESHOLD_PX = 5;

const SCROLL_DIRECTION_EPSILON_PX = 0.5;

export function isAtScrollBottom(
  element,
  threshold = SCROLL_BOTTOM_THRESHOLD_PX,
) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
  );
}

export function nextScrollFollowState({
  atBottom,
  following,
  previousScrollTop,
  scrollTop,
}) {
  const scrollDelta = scrollTop - previousScrollTop;
  const movedUp = scrollDelta < -SCROLL_DIRECTION_EPSILON_PX;
  const movedDown = scrollDelta > SCROLL_DIRECTION_EPSILON_PX;

  if (following && movedUp && !atBottom) {
    return false;
  }

  if (!following && movedDown && atBottom) {
    return true;
  }

  return following;
}

function isUpwardScrollKey(event) {
  return (
    event.key === "ArrowUp" ||
    event.key === "Home" ||
    event.key === "PageUp" ||
    ((event.key === " " || event.key === "Spacebar") && event.shiftKey)
  );
}

function isDownwardScrollKey(event) {
  return (
    event.key === "ArrowDown" ||
    event.key === "End" ||
    event.key === "PageDown" ||
    ((event.key === " " || event.key === "Spacebar") && !event.shiftKey)
  );
}

export function useScrollFollow({
  content,
  enabled = true,
  followRef: suppliedFollowRef,
  onFollowChange,
  scrollRef: suppliedScrollRef,
} = {}) {
  const localFollowRef = React.useRef(true);
  const localScrollRef = React.useRef(null);
  const followRef = suppliedFollowRef ?? localFollowRef;
  const scrollRef = suppliedScrollRef ?? localScrollRef;
  const enabledRef = React.useRef(enabled);
  const followFrameRef = React.useRef(null);
  const lastScrollTopRef = React.useRef(0);
  const onFollowChangeRef = React.useRef(onFollowChange);
  const touchYRef = React.useRef(null);

  enabledRef.current = enabled;
  onFollowChangeRef.current = onFollowChange;

  const cancelScheduledFollow = React.useCallback(() => {
    if (followFrameRef.current !== null) {
      globalThis.cancelAnimationFrame?.(followFrameRef.current);
      followFrameRef.current = null;
    }
  }, []);

  const setFollowing = React.useCallback(
    (following) => {
      if (followRef.current === following) {
        return;
      }

      followRef.current = following;
      onFollowChangeRef.current?.(following);
    },
    [followRef],
  );

  const pauseFollowing = React.useCallback(() => {
    cancelScheduledFollow();
    setFollowing(false);
  }, [cancelScheduledFollow, setFollowing]);

  const resumeFollowing = React.useCallback(() => {
    setFollowing(true);
  }, [setFollowing]);

  React.useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !enabled || !followRef.current) {
      return;
    }

    const follow = () => {
      followFrameRef.current = null;
      if (
        !enabledRef.current ||
        !followRef.current ||
        scrollRef.current !== element
      ) {
        return;
      }

      element.scrollTop = element.scrollHeight;
      lastScrollTopRef.current = element.scrollTop;
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      if (followFrameRef.current === null) {
        followFrameRef.current = globalThis.requestAnimationFrame(follow);
      }
    } else {
      follow();
    }
  }, [content, enabled, followRef, scrollRef]);

  React.useEffect(
    () => () => {
      cancelScheduledFollow();
    },
    [cancelScheduledFollow],
  );

  const onScroll = React.useCallback(
    (event) => {
      const element = event.currentTarget;
      const scrollTop = element.scrollTop;
      const following = nextScrollFollowState({
        atBottom: isAtScrollBottom(element),
        following: followRef.current,
        previousScrollTop: lastScrollTopRef.current,
        scrollTop,
      });

      lastScrollTopRef.current = scrollTop;
      if (!following) {
        cancelScheduledFollow();
      }
      setFollowing(following);
    },
    [cancelScheduledFollow, followRef, setFollowing],
  );

  const onWheel = React.useCallback(
    (event) => {
      if (event.deltaY < 0) {
        pauseFollowing();
      } else if (event.deltaY > 0 && isAtScrollBottom(event.currentTarget)) {
        resumeFollowing();
      }
    },
    [pauseFollowing, resumeFollowing],
  );

  const onKeyDown = React.useCallback(
    (event) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      if (isUpwardScrollKey(event)) {
        pauseFollowing();
      } else if (
        isDownwardScrollKey(event) &&
        isAtScrollBottom(event.currentTarget)
      ) {
        resumeFollowing();
      }
    },
    [pauseFollowing, resumeFollowing],
  );

  const onTouchStart = React.useCallback((event) => {
    touchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onTouchMove = React.useCallback(
    (event) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY === undefined) {
        return;
      }

      if (touchYRef.current !== null && nextY > touchYRef.current) {
        pauseFollowing();
      }
      touchYRef.current = nextY;
    },
    [pauseFollowing],
  );

  const onTouchEnd = React.useCallback(() => {
    touchYRef.current = null;
  }, []);

  const scrollToBottom = React.useCallback(
    ({ behavior = "auto" } = {}) => {
      const element = scrollRef.current;
      if (!element) {
        return;
      }

      cancelScheduledFollow();
      resumeFollowing();
      element.scrollTo({ top: element.scrollHeight, behavior });
    },
    [cancelScheduledFollow, resumeFollowing, scrollRef],
  );

  return {
    onKeyDown,
    onScroll,
    onTouchEnd,
    onTouchMove,
    onTouchStart,
    onWheel,
    pauseFollowing,
    resumeFollowing,
    scrollRef,
    scrollToBottom,
  };
}
