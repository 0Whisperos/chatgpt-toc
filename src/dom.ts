import { label, type DomMessage } from './types';

export interface Surface { root: HTMLElement; scroller: HTMLElement }
export interface Anchor { id: string | null; offset: number; scrollTop: number }
const fallbackIds = new WeakMap<Element, string>();
let nextFallback = 0;

export function visible(element: Element): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true' ||
        current.hasAttribute('inert')) return false;
    const css = getComputedStyle(current);
    if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse') return false;
  }
  return true;
}

export function findSurface(): Surface | null {
  const mains = [...document.querySelectorAll<HTMLElement>('main, [role="main"]')].filter(visible);
  for (const root of mains.reverse()) {
    const preferred = [...root.querySelectorAll<HTMLElement>('[data-app-action-timeline-scroll], .thread-scroll-container, [role="region"]')]
      .find(e => visible(e) && e.clientHeight > 0 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
    if (preferred) return { root, scroller: preferred };
    const user = root.querySelector<HTMLElement>('[data-user-message-bubble], [data-message-author-role="user"]');
    if (!user || !visible(user)) continue;
    for (let ancestor = user.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(ancestor).overflowY) && ancestor.clientHeight > 0) {
        return { root, scroller: ancestor };
      }
    }
    return { root, scroller: document.scrollingElement as HTMLElement || root };
  }
  return null;
}

export function idFor(element: Element): string | null {
  const wrapper = element.closest('[data-message-id], [data-chatgpt-search-message-ids]');
  const id = wrapper?.getAttribute('data-message-id') ?? wrapper?.getAttribute('data-chatgpt-search-message-ids');
  return id?.split(/[\s,]+/).filter(Boolean)[0] ?? null;
}

export function collectMessages(surface: Surface): DomMessage[] {
  const entries: DomMessage[] = [];
  const seen = new Set<string>();
  const candidates = surface.root.querySelectorAll<HTMLElement>('[data-user-message-bubble], [data-message-author-role="user"]');
  for (const element of candidates) {
    if (!surface.scroller.contains(element) || !visible(element)) continue;
    // New and old selectors can be nested around the same bubble.
    if (element.matches('[data-message-author-role]') && element.querySelector('[data-user-message-bubble]')) continue;
    let id = idFor(element);
    if (!id) {
      const turn = element.closest('[data-testid^="conversation-turn-"]');
      const turnId = turn?.getAttribute('data-testid');
      if (turnId) id = `dom:${turnId}`;
      else {
        id = fallbackIds.get(element) ?? `ephemeral:${++nextFallback}`;
        fallbackIds.set(element, id);
      }
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('button, svg, .sr-only, [aria-hidden="true"], annotation').forEach(e => e.remove());
    let text = clone.textContent?.trim() ?? '';
    if (!text) {
      const attachments = [...element.querySelectorAll('img[alt], [data-filename]')]
        .map(e => e.getAttribute('alt') || e.getAttribute('data-filename')).filter(Boolean);
      text = attachments.length ? `[附件：${attachments.join('、')}]` : '（附件消息）';
    }
    const turn = element.closest<HTMLElement>('[data-content-search-turn-key], [data-testid^="conversation-turn-"], article') ?? element;
    entries.push({ id, text: text.slice(0, 16_000), order: entries.length, source: 'dom', element, turn });
  }
  return entries;
}

export function messageElements(surface: Surface): Map<string, HTMLElement> {
  const elements = new Map<string, HTMLElement>();
  for (const e of surface.root.querySelectorAll<HTMLElement>('[data-message-id], [data-chatgpt-search-message-ids]')) {
    if (!visible(e) || !surface.scroller.contains(e)) continue;
    for (const id of (e.getAttribute('data-message-id') ?? e.getAttribute('data-chatgpt-search-message-ids') ?? '').split(/[\s,]+/)) {
      if (id) elements.set(id, e);
    }
  }
  return elements;
}

export function viewportTop(scroller: HTMLElement): number {
  return scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
}

export function captureAnchor(surface: Surface): Anchor {
  const top = viewportTop(surface.scroller);
  const candidates = [...messageElements(surface)].map(([id, el]) => ({ id, offset: el.getBoundingClientRect().top - top }));
  const candidate = candidates.sort((a, b) => Math.abs(a.offset - 80) - Math.abs(b.offset - 80))[0];
  return { id: candidate?.id ?? null, offset: candidate?.offset ?? 0, scrollTop: surface.scroller.scrollTop };
}

export function restoreAnchor(surface: Surface, anchor: Anchor): void {
  const element = anchor.id ? messageElements(surface).get(anchor.id) : null;
  if (element) surface.scroller.scrollTop += element.getBoundingClientRect().top - viewportTop(surface.scroller) - anchor.offset;
  else surface.scroller.scrollTop = anchor.scrollTop;
}

export function summary(text: string): string { return label(text).slice(0, 180); }
