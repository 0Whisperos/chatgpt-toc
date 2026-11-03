import { collectMessages, findSurface, messageElements, viewportTop, type Surface } from './dom';
import { emptyIndex, mergeDom } from './model';
import { Navigation } from './navigation';
import { validateIndex } from './parser';
import { Panel } from './panel';
import { conversationId, MAX_BRIDGE_SIZE, READY_EVENT, SNAPSHOT_EVENT, type ConversationIndex } from './types';

function start(): void {
  if (document.getElementById('chatgpt-toc-extension')) return;
  const panel = new Panel();
  let path = location.pathname;
  let id = conversationId(path) ?? `draft:${path}`;
  let index = emptyIndex(id);
  let surface: Surface | null = null;
  let domMessages: ReturnType<typeof collectMessages> = [];
  let mutationTimer = 0;
  let activeFrame = 0;
  let previousTop = 0;
  let surfaceObserver: MutationObserver | null = null;
  let scrollTarget: EventTarget | null = null;
  let scanning = false;
  let dataRevision = 0;
  let scanRevision = 0;
  let awaitingDom = false;
  let staleIds = new Set<string>();
  let receivedSnapshot = false;

  const navigation = new Navigation({
    surface: () => awaitingDom ? null : surface,
    index: () => index,
    refresh: direction => refresh(direction),
    busy: value => { panel.setBusy(value); if (!value) scanning = false; },
    status: (message, retry) => panel.setStatus(message, retry),
    selected: selected => panel.setActive(selected),
    scanned: (messages, complete) => {
      if (scanRevision !== dataRevision) return;
      // Retain previously discovered messages if an interrupted scan is partial.
      const base = complete ? emptyIndex(id) : index;
      index = mergeDom(base, messages, 'up');
      index.completeness = complete ? 'complete' : 'partial';
      panel.update(index, true);
    },
    host: panel.host,
  });
  panel.onJump = target => { scanning = false; void navigation.jump(target); };
  panel.onScan = () => { scanning = true; scanRevision = dataRevision; void navigation.scan(); };
  panel.onCancel = () => navigation.cancel();
  panel.onRetry = () => navigation.retry();

  function updateTheme(): void {
    const root = document.documentElement;
    const theme = root.getAttribute('data-theme');
    const style = getComputedStyle(root);
    let dark = root.classList.contains('dark') || theme === 'dark' || style.colorScheme === 'dark';
    if (!dark && !root.classList.contains('light') && theme !== 'light') {
      const rgb = (getComputedStyle(document.body ?? root).backgroundColor).match(/\d+(?:\.\d+)?/g)?.map(Number);
      if (rgb && rgb.length >= 3 && (rgb.length < 4 || rgb[3] > 0)) dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 128;
      else dark = matchMedia('(prefers-color-scheme: dark)').matches;
    }
    panel.setTheme(dark);
  }

  function updateActive(): void {
    activeFrame = 0;
    if (!surface || navigation.running || awaitingDom) return;
    const baseline = viewportTop(surface.scroller) + 110;
    const owners = new Map(index.timeline.map(t => [t.id, t.userId]));
    const candidates: { top: number; id: string }[] = domMessages.map(m => ({ top: m.element.getBoundingClientRect().top, id: m.id }));
    for (const [messageId, element] of messageElements(surface)) {
      const owner = owners.get(messageId);
      if (owner) candidates.push({ top: element.getBoundingClientRect().top, id: owner });
    }
    candidates.sort((a, b) => a.top - b.top);
    let selected: string | null = candidates[0]?.id ?? null;
    for (const candidate of candidates) {
      if (candidate.top > baseline) break;
      selected = candidate.id;
    }
    // Some virtualizers mount a whole turn but give IDs only to the user bubble.
    if (!candidates.length && index.messages.length === 0) selected = null;
    panel.setActive(selected);
  }

  function onScroll(): void {
    if (!activeFrame) activeFrame = requestAnimationFrame(updateActive);
  }

  function scheduleRefresh(): void {
    if (mutationTimer) return;
    mutationTimer = window.setTimeout(() => { mutationTimer = 0; refresh(); }, 120);
  }

  function bindSurface(next: Surface | null): void {
    if (surface?.root === next?.root && surface?.scroller === next?.scroller) return;
    navigation.cancel('route');
    surfaceObserver?.disconnect();
    scrollTarget?.removeEventListener('scroll', onScroll);
    surface = next;
    domMessages = [];
    if (!next) return;
    previousTop = next.scroller.scrollTop;
    scrollTarget = next.scroller === document.scrollingElement ? document : next.scroller;
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    surfaceObserver = new MutationObserver(scheduleRefresh);
    surfaceObserver.observe(next.root, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['data-message-id', 'data-chatgpt-search-message-ids', 'data-user-message-bubble', 'hidden', 'aria-hidden'] });
  }

  function refresh(direction?: 'up' | 'down'): void {
    if (location.pathname !== path) { routeChanged(); return; }
    const next = findSurface();
    bindSurface(next);
    if (surface) {
      domMessages = collectMessages(surface);
      if (awaitingDom) {
        const ids = new Set(index.messages.map(m => m.id));
        const matchesSnapshot = receivedSnapshot && domMessages.some(m => ids.has(m.id));
        const replaced = domMessages.length > 0 && domMessages.every(m => !staleIds.has(m.id));
        if (matchesSnapshot || replaced) {
          awaitingDom = false;
          staleIds.clear();
        } else domMessages = [];
      }
      const actualDirection = direction ?? (surface.scroller.scrollTop < previousTop ? 'up' : 'down');
      previousTop = surface.scroller.scrollTop;
      if (!scanning && !awaitingDom) {
        let batch = domMessages;
        // A virtualized viewport may contain only the newly appended user bubble,
        // while the preceding assistant message still provides a branch anchor.
        if (index.completeness === 'complete' && batch.length && !batch.some(m => index.messages.some(x => x.id === m.id))) {
          const owners = new Map(index.timeline.map(t => [t.id, t.userId]));
          const firstTop = batch[0].element.getBoundingClientRect().top;
          const preceding = [...messageElements(surface)].map(([mid, element]) => ({
            id: owners.get(mid), top: element.getBoundingClientRect().top,
          })).filter(a => a.id && a.top < firstTop).sort((a, b) => b.top - a.top)[0];
          const anchor = index.messages.find(m => m.id === preceding?.id);
          if (anchor) batch = [{ ...batch[0], ...anchor }, ...batch];
        }
        index = mergeDom(index, batch, actualDirection);
        const owners = new Map(index.timeline.map(t => [t.id, t.userId]));
        const users = new Set(domMessages.map(m => m.id));
        const known = new Set(index.messages.map(m => m.id));
        let owner: string | null = null;
        const mounted = [...messageElements(surface)].map(([mid, element]) => ({ mid, top: element.getBoundingClientRect().top }))
          .sort((a, b) => a.top - b.top);
        for (const entry of mounted) {
          owner = users.has(entry.mid) ? entry.mid : owners.get(entry.mid) ?? owner;
          if (owner && known.has(owner)) owners.set(entry.mid, owner);
        }
        index.timeline = [...owners].map(([mid, userId]) => ({ id: mid, userId }));
      }
    }
    panel.update(index, !!surface && (!!conversationId(path) || index.messages.length > 0));
    updateTheme();
    onScroll();
  }

  function routeChanged(): void {
    navigation.cancel('route');
    scanning = false;
    const promotion = !conversationId(path) && !!conversationId(location.pathname);
    staleIds = new Set(domMessages.map(m => m.id));
    awaitingDom = !promotion && staleIds.size > 0;
    receivedSnapshot = false;
    path = location.pathname;
    id = conversationId(path) ?? `draft:${path}`;
    index = promotion ? { ...index, conversationId: id } : emptyIndex(id);
    dataRevision++;
    panel.setActive(null);
    panel.update(index, false);
    bindSurface(null);
    refresh();
    window.dispatchEvent(new Event(READY_EVENT));
  }

  window.addEventListener(SNAPSHOT_EVENT, event => {
    const detail: unknown = (event as CustomEvent).detail;
    if (typeof detail !== 'string' || detail.length > MAX_BRIDGE_SIZE) return;
    if (location.pathname !== path) routeChanged();
    try {
      const parsed: unknown = JSON.parse(detail);
      if (!validateIndex(parsed, id)) return;
      index = parsed as ConversationIndex;
      receivedSnapshot = true;
      dataRevision++;
      refresh();
    } catch { /* Treat page-origin events as untrusted input. */ }
  });

  const shellObserver = new MutationObserver(records => {
    // Shadow DOM changes are not observed. Ignore unrelated page streaming here;
    // the bound conversation observer batches those changes separately.
    if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element &&
      (n.matches('main, [role="main"], .thread-scroll-container') || !!n.querySelector('main, [role="main"], .thread-scroll-container'))))) scheduleRefresh();
  });
  shellObserver.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateTheme);
  window.addEventListener('resize', scheduleRefresh, { passive: true });
  window.addEventListener('popstate', () => { if (location.pathname !== path) routeChanged(); });
  // pushState doesn't fire popstate, and runs in another JavaScript world.
  window.setInterval(() => {
    if (location.pathname !== path) routeChanged();
    else if (!surface || !surface.root.isConnected || surface.root.getClientRects().length === 0) refresh();
  }, 350);
  refresh();
  window.dispatchEvent(new Event(READY_EVENT));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
