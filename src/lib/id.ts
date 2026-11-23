/** Collision-resistant, URL-safe identifiers. */
export function createId(prefix?: string): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${raw.slice(0, 20)}` : raw.slice(0, 20);
}

export const nowIso = () => new Date().toISOString();
