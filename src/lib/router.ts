import { useEffect, useState } from 'react';

/**
 * Minimal hash router. Kept intentionally tiny; swap for react-router when the
 * app needs nested routes or server rendering.
 */
export type Route = { name: 'layouts' } | { name: 'editor'; layoutId: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const m = /^\/layouts\/([\w-]+)$/.exec(path);
  if (m) return { name: 'editor', layoutId: m[1]! };
  return { name: 'layouts' };
}

export function navigate(path: string) {
  if (window.location.hash !== `#${path}`) window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
