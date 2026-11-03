import { captureAnchor, collectMessages, messageElements, restoreAnchor, viewportTop, type Anchor, type Surface } from './dom';
import type { ConversationIndex } from './types';

export interface NavigationHooks {
  surface(): Surface | null;
  index(): ConversationIndex;
  refresh(direction?: 'up' | 'down'): void;
  busy(value: boolean): void;
  status(message?: string, retry?: boolean): void;
  selected(id: string): void;
  scanned(messages: ReturnType<typeof collectMessages>, complete: boolean): void;
  host: HTMLElement;
}

interface Job {
  controller: AbortController;
  surface: Surface;
  anchor: Anchor;
  deadline: number;
  reason?: 'user' | 'route' | 'cancel' | 'timeout' | 'replace';
  cleanup(): void;
}

export class Navigation {
  private job: Job | null = null;
  private retryId: string | null = null;
  constructor(private hooks: NavigationHooks, private timeoutMs = 60_000, private settleMs = 160) {}
  get running(): boolean { return this.job !== null; }

  cancel(reason: Job['reason'] = 'cancel'): void {
    const job = this.job;
    if (!job) return;
    job.reason = reason;
    job.controller.abort();
    job.cleanup();
    this.job = null;
    this.hooks.busy(false);
    if (reason === 'route' || reason === 'replace') return;
    if (reason !== 'user') restoreAnchor(job.surface, job.anchor);
    this.hooks.refresh();
    this.hooks.status(reason === 'timeout' ? '操作超时，已保留目录；可重试或扫描历史' : '已取消，已保留收集到的目录', !!this.retryId);
  }

  retry(): void { if (this.retryId) void this.jump(this.retryId); }

  private begin(): Job | null {
    this.cancel('replace');
    const surface = this.hooks.surface();
    if (!surface) { this.hooks.status('尚未找到当前对话，请等待消息加载'); return null; }
    const controller = new AbortController();
    const job: Job = {
      controller, surface, anchor: captureAnchor(surface), deadline: Date.now() + this.timeoutMs,
      cleanup: () => {},
    };
    const cancelInput = (event: Event) => {
      if (event.composedPath().includes(this.hooks.host)) return;
      if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
      if (event instanceof PointerEvent) {
        const rect = surface.scroller.getBoundingClientRect();
        if (event.clientX < rect.right - 22 || event.clientY < rect.top || event.clientY > rect.bottom) return;
      }
      this.cancel('user');
    };
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
      window.addEventListener(type, cancelInput, { capture: true, passive: true });
    }
    const timer = window.setTimeout(() => { if (this.job === job) this.cancel('timeout'); }, this.timeoutMs);
    job.cleanup = () => {
      window.clearTimeout(timer);
      for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.removeEventListener(type, cancelInput, true);
    };
    this.job = job;
    this.hooks.busy(true);
    return job;
  }

  private live(job: Job): boolean {
    if (job.controller.signal.aborted || this.job !== job) return false;
    const current = this.hooks.surface();
    if (!job.surface.root.isConnected || current?.root !== job.surface.root || current.scroller !== job.surface.scroller) {
      this.cancel('route');
      return false;
    }
    if (Date.now() >= job.deadline) { this.cancel('timeout'); return false; }
    return true;
  }

  private async wait(job: Job, ms = this.settleMs): Promise<boolean> {
    if (!this.live(job)) return false;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); job.controller.signal.removeEventListener('abort', done); resolve(); };
      const timer = window.setTimeout(done, ms);
      job.controller.signal.addEventListener('abort', done, { once: true });
    });
    return this.live(job);
  }

  private finish(job: Job): void {
    if (this.job !== job) return;
    job.cleanup();
    this.job = null;
    this.hooks.busy(false);
  }

  private find(id: string, surface: Surface): HTMLElement | null {
    return collectMessages(surface).find(m => m.id === id)?.element ?? messageElements(surface).get(id) ?? null;
  }

  private align(element: HTMLElement, surface: Surface): void {
    const rect = element.getBoundingClientRect();
    const offset = viewportTop(surface.scroller) + 84;
    surface.scroller.scrollTop += rect.top - offset;
  }

  async jump(id: string): Promise<void> {
    this.retryId = id;
    const job = this.begin();
    if (!job) return;
    const surface = job.surface;
    try {
      this.hooks.status('正在定位提问…');
      let target = this.find(id, surface);
      const index = this.hooks.index();
      const order = index.messages.findIndex(m => m.id === id);
      const total = index.messages.length;
      if (!target && order >= 0) {
        // Use nearby measured anchors before falling back to a proportional estimate.
        const mounted = collectMessages(surface);
        const anchors = mounted.map(m => ({ message: m, order: index.messages.findIndex(x => x.id === m.id) }))
          .filter(a => a.order >= 0).sort((a, b) => a.order - b.order);
        const first = anchors[0];
        const last = anchors.at(-1);
        let estimate = total <= 1 ? 0 : order / (total - 1) * (surface.scroller.scrollHeight - surface.scroller.clientHeight);
        if (first && last && last.order > first.order) {
          const firstY = first.message.element.getBoundingClientRect().top;
          const step = (last.message.element.getBoundingClientRect().top - firstY) / (last.order - first.order);
          estimate = surface.scroller.scrollTop + firstY - viewportTop(surface.scroller) + (order - first.order) * step - 84;
        }
        surface.scroller.scrollTop = Math.max(0, estimate);
        if (!await this.wait(job)) return;
        this.hooks.refresh(order < (first?.order ?? 0) ? 'up' : 'down');
        target = this.find(id, surface);
      }

      // Refine by ordering when the virtualizer exposes nearby known messages.
      let steps = 0;
      let stagnant = 0;
      while (!target && this.live(job)) {
        const mounted = collectMessages(surface);
        const positions = mounted.map(m => index.messages.findIndex(x => x.id === m.id)).filter(n => n >= 0);
        let direction: 'up' | 'down' = positions.length && order < Math.min(...positions) ? 'up' : 'down';
        if (!positions.length) direction = order < total / 2 ? 'up' : 'down';
        // An ID-less partial index cannot locate a remounted node reliably.
        if (id.startsWith('ephemeral:')) break;
        const previous = surface.scroller.scrollTop;
        const height = Math.max(100, surface.scroller.clientHeight * .7);
        surface.scroller.scrollTop = previous + (direction === 'up' ? -height : height);
        if (!await this.wait(job)) return;
        this.hooks.refresh(direction);
        target = this.find(id, surface);
        const moved = Math.abs(surface.scroller.scrollTop - previous) > 1;
        stagnant = moved ? 0 : stagnant + 1;
        this.hooks.status(`正在加载目标附近的历史消息… ${++steps}`);
        if (stagnant >= 8) break;
      }
      if (!target || !this.live(job)) {
        if (this.live(job)) {
          restoreAnchor(surface, job.anchor);
          this.finish(job);
          this.hooks.status('未找到目标消息；可重试或加载完整目录', true);
        }
        return;
      }
      // Layout may change after loading. Verify ID and alignment after settling.
      for (let attempt = 0; attempt < 3; attempt++) {
        this.align(target, surface);
        if (!await this.wait(job)) return;
        const mounted = this.find(id, surface);
        if (!mounted) {
          target = null;
          break;
        }
        target = mounted;
        const offset = target.getBoundingClientRect().top - viewportTop(surface.scroller);
        if (Math.abs(offset - 84) < 12 || surface.scroller.scrollTop < 1) break;
      }
      if (!target || !this.live(job)) {
        if (this.live(job)) {
          this.finish(job);
          this.hooks.status('目标在加载时发生变化，请重试', true);
        }
        return;
      }
      const rect = target.getBoundingClientRect();
      const top = viewportTop(surface.scroller);
      if (rect.bottom <= top || rect.top >= top + surface.scroller.clientHeight) {
        this.finish(job);
        this.hooks.status('尚未滚动到目标，请重试', true);
        return;
      }
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        target.animate([{ outline: '2px solid #7781ff', outlineOffset: '5px' }, { outline: '2px solid transparent', outlineOffset: '5px' }], { duration: 1400 });
      }
      this.hooks.refresh();
      this.finish(job);
      this.hooks.selected(id);
      this.hooks.status('已定位到对应提问');
    } catch {
      if (this.job === job) {
        this.finish(job);
        this.hooks.status('页面结构发生变化，定位未完成，请重试', true);
      }
    }
  }

  async scan(): Promise<void> {
    this.retryId = null;
    const job = this.begin();
    if (!job) return;
    const surface = job.surface;
    const collected = new Map<string, ReturnType<typeof collectMessages>[number]>();
    const coordinates = new Map<string, number>();
    const add = () => {
      for (const m of collectMessages(surface)) {
        collected.set(m.id, m);
        coordinates.set(m.id, surface.scroller.scrollTop + m.element.getBoundingClientRect().top - viewportTop(surface.scroller));
      }
      this.hooks.scanned([...collected.values()], false);
      this.hooks.status(`正在扫描历史消息… 已收集 ${collected.size} 次提问`);
    };
    try {
      // Reach a stable top, allowing time for prepended history to load.
      let topStable = 0;
      let fingerprint = '';
      while (this.live(job) && topStable < 5) {
        surface.scroller.scrollTop = 0;
        if (!await this.wait(job, Math.max(300, this.settleMs))) return;
        const messages = collectMessages(surface);
        const key = `${messages[0]?.id}:${surface.scroller.scrollHeight}`;
        topStable = surface.scroller.scrollTop <= 1 && key === fingerprint ? topStable + 1 : 0;
        fingerprint = key;
      }
      // Only collect forwards so the insertion order is the conversation order.
      add();
      let bottomStable = 0;
      let previousBottom = '';
      while (this.live(job) && bottomStable < 5) {
        surface.scroller.scrollTop += Math.max(100, surface.scroller.clientHeight * .7);
        if (!await this.wait(job)) return;
        add();
        const atBottom = surface.scroller.scrollTop + surface.scroller.clientHeight >= surface.scroller.scrollHeight - 2;
        const key = `${surface.scroller.scrollHeight}:${[...collected.keys()].at(-1)}`;
        bottomStable = atBottom && key === previousBottom ? bottomStable + 1 : 0;
        previousBottom = key;
      }
      if (!this.live(job)) return;
      const hasLoader = !!surface.root.querySelector('[aria-busy="true"], [role="progressbar"], [data-loading="true"]');
      const first = [...collected.values()][0];
      // A quiet scroll boundary alone doesn't prove all server history is loaded.
      // Accept an explicit beginning marker or a stable, absolute turn-0 marker.
      const startMarker = first?.turn.getAttribute('data-testid') === 'conversation-turn-0' ||
        first?.turn.matches('[data-conversation-start="true"], [data-history-start="true"]') ||
        surface.root.querySelector('[data-conversation-start="true"], [data-history-start="true"]') !== null;
      const complete = topStable >= 5 && bottomStable >= 5 && !!startMarker && !hasLoader &&
        ![...collected.keys()].some(id => id.startsWith('ephemeral:'));
      const result = [...collected.values()];
      this.hooks.scanned(result, complete);
      // Restore by the original message ID even if its DOM node was unmounted.
      const anchorCoordinate = job.anchor.id ? coordinates.get(job.anchor.id) : undefined;
      const restoreTop = anchorCoordinate == null ? job.anchor.scrollTop : anchorCoordinate - job.anchor.offset;
      surface.scroller.scrollTop = restoreTop;
      if (!await this.wait(job)) return;
      restoreAnchor(surface, { ...job.anchor, scrollTop: restoreTop });
      this.finish(job);
      this.hooks.status(complete ? `已完整扫描 ${collected.size} 次提问，并恢复阅读位置` : `已扫描 ${collected.size} 次提问；无法确认历史起点，目录仍标记为未完整`);
    } catch {
      if (this.job === job) {
        restoreAnchor(surface, job.anchor);
        this.finish(job);
        this.hooks.status('扫描中断，已保留收集到的目录，可重新扫描');
      }
    }
  }
}
