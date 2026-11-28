import { useEffect, useState } from 'react';

/** Re-renders when a CSS media query starts or stops matching. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Phones: the editor is view-only (look around, visit, download the PDF). */
export const PHONE_QUERY = '(max-width: 640px), (max-height: 500px) and (pointer: coarse)';
/** Tablets and small windows: the side panel becomes a drawer over the 3D view. */
export const NARROW_QUERY = '(max-width: 1024px)';
/** A touchscreen is the main input (no hover, no keyboard assumed). */
export const TOUCH_QUERY = '(pointer: coarse)';

export const usePhone = () => useMediaQuery(PHONE_QUERY);
export const useNarrow = () => useMediaQuery(NARROW_QUERY);
export const useTouch = () => useMediaQuery(TOUCH_QUERY);
