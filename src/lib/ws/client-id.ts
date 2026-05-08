// Stable per-renderer ID used to attribute WebSocket origin and dedupe
// REST mutation broadcasts back to the originating window.
let cachedClientId: string | null = null;

function generateClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getClientId(): string {
  if (cachedClientId === null) {
    cachedClientId = generateClientId();
  }
  return cachedClientId;
}
