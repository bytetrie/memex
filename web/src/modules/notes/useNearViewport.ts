// True once the element has come near the viewport, and from then on: heavy blocks (archive
// embeds, drawings) mount their content lazily and then stay mounted, so a playing video keeps
// playing when it scrolls out of view.

import { useEffect, useState, type RefObject } from "react";

export function useNearViewport(ref: RefObject<Element | null>, margin = "600px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref, near, margin]);
  return near;
}
