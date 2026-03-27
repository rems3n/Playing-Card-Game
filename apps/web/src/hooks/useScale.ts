'use client';

import { useEffect, useState, useRef, type RefObject } from 'react';

/**
 * Measures a container and returns a scale factor relative to a design width.
 * Everything inside the container can use this to scale proportionally.
 */
export function useScale(designWidth: number = 900): {
  ref: RefObject<HTMLDivElement | null>;
  scale: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        // Clamp between 0.7 and 1.6
        const s = Math.min(1.6, Math.max(0.7, width / designWidth));
        setScale(s);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [designWidth]);

  return { ref, scale };
}
