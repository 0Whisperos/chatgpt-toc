import { parseConversation } from './parser';
import { conversationId, MAX_BRIDGE_SIZE, READY_EVENT, SNAPSHOT_EVENT } from './types';

// This script runs before the application fetches its conversation. It never sends
// requests, reads credentials, or alters request/response bodies seen by the app.
let latest: string | null = null;
let latestId: string | null = null;
let latestSequence = 0;
let nextSequence = 0;
let route = location.pathname;

function requestId(url: unknown): string | null {
  try {
    const parsed = new URL(String(url), location.href);
    if (parsed.origin !== location.origin) return null;
    return parsed.pathname.match(/^\/backend-api\/(?:f\/)?conversation\/([a-zA-Z0-9-]+)\/?$/)?.[1] ?? null;
  } catch { return null; }
}

function accept(value: unknown, id: string, sequence: number, requestRoute: string): void {
  if (requestRoute !== location.pathname || id !== conversationId(location.pathname) || sequence < latestSequence) return;
  const index = parseConversation(value, id);
  if (!index) return;
  const detail = JSON.stringify(index);
  if (detail.length > MAX_BRIDGE_SIZE) return;
  route = requestRoute;
  latest = detail;
  latestId = id;
  latestSequence = sequence;
  window.dispatchEvent(new CustomEvent(SNAPSHOT_EVENT, { detail }));
}

const originalFetch = window.fetch;
window.fetch = function (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  const input = args[0];
  const url = input instanceof Request ? input.url : input;
  const method = String(args[1]?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const id = method === 'GET' ? requestId(url) : null;
  const sequence = ++nextSequence;
  const requestRoute = location.pathname;
  const result = Reflect.apply(originalFetch, this, args) as ReturnType<typeof fetch>;
  if (id) void result.then(response => {
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return;
    const size = Number(response.headers.get('content-length'));
    if (size > 32_000_000) return;
    void response.clone().text().then(raw => {
      if (raw.length <= 32_000_000) accept(JSON.parse(raw), id, sequence, requestRoute);
    }).catch(() => {});
  }).catch(() => {});
  return result;
};

const xhrRequests = new WeakMap<XMLHttpRequest, { id: string; sequence: number; route: string }>();
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  xhrRequests.delete(this);
  const id = method.toUpperCase() === 'GET' ? requestId(url) : null;
  if (id) xhrRequests.set(this, { id, sequence: ++nextSequence, route: location.pathname });
  Reflect.apply(originalOpen, this, [method, url, ...rest]);
} as typeof originalOpen;
XMLHttpRequest.prototype.send = function (...args: Parameters<XMLHttpRequest['send']>) {
  const pending = xhrRequests.get(this);
  if (pending) this.addEventListener('load', () => {
    try {
      if (this.status < 200 || this.status >= 300) return;
      if (this.responseType === 'json') accept(this.response, pending.id, pending.sequence, pending.route);
      else if ((this.responseType === '' || this.responseType === 'text') && this.responseText.length <= 32_000_000) {
        accept(JSON.parse(this.responseText), pending.id, pending.sequence, pending.route);
      }
    } catch { /* Schema or response type is unsupported; DOM fallback stays available. */ }
  }, { once: true });
  return Reflect.apply(originalSend, this, args);
};

window.addEventListener(READY_EVENT, () => {
  if (latest && latestId === conversationId(location.pathname) && route === location.pathname) {
    window.dispatchEvent(new CustomEvent(SNAPSHOT_EVENT, { detail: latest }));
  }
});

// Do not retain another conversation's text after SPA navigation.
window.setInterval(() => {
  if (route !== location.pathname) {
    route = location.pathname;
    latest = null;
    latestId = null;
    latestSequence = 0;
  }
}, 300);
