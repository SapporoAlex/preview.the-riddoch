/**
 * Small typed wrapper around localStorage with cross-tab change notification.
 * All keys are namespaced so the prototype can't collide with other apps.
 */
import { ServiceError } from '../contracts';

const NS = 'gallery-studio:v1:';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gallery-studio') : null;
type Listener = (key: string) => void;
const listeners = new Set<Listener>();

function emit(key: string) {
  listeners.forEach((l) => l(key));
}

if (channel) {
  channel.addEventListener('message', (e: MessageEvent<{ key: string }>) => emit(e.data.key));
} else {
  window.addEventListener('storage', (e) => {
    if (e.key?.startsWith(NS)) emit(e.key.slice(NS.length));
  });
}

export const kv = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch {
      throw new ServiceError('storage_full', 'Local storage is full. Remove some layouts and try again.');
    }
    channel?.postMessage({ key });
    emit(key);
  },
  remove(key: string): void {
    localStorage.removeItem(NS + key);
    channel?.postMessage({ key });
    emit(key);
  },
  /** Subscribe to changes of keys matching a predicate (same tab and other tabs). */
  watch(match: (key: string) => boolean, cb: (key: string) => void): () => void {
    const l: Listener = (k) => match(k) && cb(k);
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Simulated network latency so loading states are exercised during development. */
export const latency = (ms = 60) => new Promise((r) => setTimeout(r, ms));
