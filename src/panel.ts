import css from './panel.css?inline';
import { windowRange } from './model';
import { summary } from './dom';
import type { ConversationIndex } from './types';

declare const chrome: { storage?: { local: {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
} } };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

export class Panel {
  readonly host = node('div');
  readonly shadow: ShadowRoot;
  private shell = node('nav', 'shell');
  private rail = node('div', 'rail');
  private ticks = node('div', 'ticks');
  private panel = node('section', 'panel');
  private list = node('div', 'list');
  private spacer = node('div', 'spacer');
  private rows = node('div', 'rows');
  private title = node('span');
  private status = node('span', 'status');
  private scan = node('button', 'action', '加载完整目录');
  private cancel = node('button', 'action', '取消');
  private retry = node('button', 'action', '重试跳转');
  private handle = node('button', 'handle', '≡');
  private index: ConversationIndex | null = null;
  private activeId: string | null = null;
  private busy = false;
  private closed = false;
  private focusedId: string | null = null;
  private announced = '';
  onJump: (id: string) => void = () => {};
  onScan: () => void = () => {};
  onCancel: () => void = () => {};
  onRetry: () => void = () => {};

  constructor() {
    this.host.id = 'chatgpt-toc-extension';
    this.host.style.cssText = 'all:initial!important;position:fixed!important;width:0!important;height:0!important;z-index:2147483000!important;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = node('style');
    style.textContent = css;
    this.shell.setAttribute('aria-label', '当前对话提问目录');
    this.panel.id = 'toc-panel';
    this.panel.setAttribute('aria-label', '提问列表');
    this.handle.title = '展开对话目录';
    this.handle.setAttribute('aria-label', '展开对话目录');
    this.handle.setAttribute('aria-controls', 'toc-panel');
    this.handle.setAttribute('aria-expanded', 'false');
    this.handle.onclick = () => {
      this.setClosed(false);
      this.shell.classList.add('open');
      this.handle.setAttribute('aria-expanded', 'true');
      this.list.focus();
    };
    this.rail.append(this.handle, this.ticks);
    const header = node('header');
    const close = node('button', 'close', '×');
    close.title = '折叠目录（点击短横线按钮重新展开）';
    close.setAttribute('aria-label', '折叠目录');
    close.onclick = () => {
      this.setClosed(true);
      this.shell.classList.remove('open');
      this.handle.setAttribute('aria-expanded', 'false');
      this.handle.focus();
    };
    header.append(this.title, close);
    this.list.tabIndex = 0;
    this.list.setAttribute('aria-label', '按提问顺序排列的目录');
    this.spacer.append(this.rows);
    this.list.append(this.spacer);
    this.list.addEventListener('scroll', () => this.renderRows());
    this.list.addEventListener('keydown', e => this.keydown(e));
    const footer = node('footer');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    const actions = node('div', 'actions');
    this.scan.onclick = () => this.onScan();
    this.cancel.onclick = () => this.onCancel();
    this.retry.onclick = () => this.onRetry();
    this.cancel.hidden = true;
    this.retry.hidden = true;
    actions.append(this.scan, this.cancel, this.retry);
    footer.append(this.status, actions);
    this.panel.append(header, this.list, footer);
    this.shell.append(this.rail, this.panel);
    this.shell.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.click();
      }
    });
    this.shadow.append(style, this.shell);
    this.host.hidden = true;
    document.documentElement.append(this.host);
    try {
      if (typeof chrome !== 'undefined') void chrome.storage?.local.get('tocClosed').then(value => {
        if (value.tocClosed === true) this.setClosed(true, false);
      }).catch(() => {});
    } catch { /* Extension reload or blocked storage should not disable navigation. */ }
    new ResizeObserver(() => this.renderRows()).observe(this.list);
  }

  private setClosed(value: boolean, persist = true): void {
    this.closed = value;
    this.shell.classList.toggle('closed', value);
    if (persist) try {
      if (typeof chrome !== 'undefined') void chrome.storage?.local.set({ tocClosed: value }).catch(() => {});
    } catch { /* Ignore unavailable storage. */ }
  }

  setTheme(dark: boolean): void { this.host.dataset.theme = dark ? 'dark' : 'light'; }

  update(index: ConversationIndex, show = true): void {
    const previousOrder = this.index?.messages.findIndex(m => m.id === this.activeId) ?? -1;
    this.index = index;
    this.host.hidden = !show;
    this.host.style.setProperty('display', show ? 'block' : 'none', 'important');
    const count = index.messages.length;
    this.title.textContent = `对话目录 · ${count} 次提问`;
    this.spacer.style.height = `${count * 38}px`;
    this.list.style.setProperty('--list-height', `${Math.max(38, Math.min(count, 9) * 38)}px`);
    this.scan.hidden = index.completeness === 'complete';
    this.scan.disabled = this.busy;
    const order = index.messages.findIndex(m => m.id === this.activeId);
    if (order >= 0 && order !== previousOrder) this.reveal(order);
    this.renderTicks();
    this.renderRows();
    if (!this.busy) this.setStatus();
  }

  setActive(id: string | null): void {
    if (id === this.activeId) return;
    this.activeId = id;
    const order = this.index?.messages.findIndex(m => m.id === id) ?? -1;
    if (order >= 0) this.reveal(order);
    this.renderTicks();
    this.renderRows();
  }

  private reveal(order: number): void {
    const y = order * 38;
    const height = this.list.clientHeight || 190;
    if (y < this.list.scrollTop || y + 38 > this.list.scrollTop + height) this.list.scrollTop = Math.max(0, y - height / 2 + 19);
  }

  setStatus(message?: string, retry = false): void {
    const text = message ?? (this.index?.completeness === 'complete' ? '当前分支目录已完整加载' : '目录尚未完整加载 · 可扫描历史消息补全');
    if (text !== this.announced) {
      this.status.textContent = text;
      this.announced = text;
    }
    this.retry.hidden = !retry;
  }

  setBusy(value: boolean): void {
    this.busy = value;
    this.cancel.hidden = !value;
    this.scan.disabled = value;
    this.retry.hidden = true;
  }

  private renderTicks(): void {
    const messages = this.index?.messages ?? [];
    const count = Math.min(messages.length, 30);
    const active = messages.findIndex(m => m.id === this.activeId);
    this.ticks.replaceChildren();
    for (let i = 0; i < count; i++) {
      const order = count === 1 ? 0 : Math.round(i * (messages.length - 1) / (count - 1));
      const next = i === count - 1 ? messages.length : Math.round((i + 1) * (messages.length - 1) / (count - 1));
      const tick = node('button', 'tick');
      const m = messages[order];
      tick.title = summary(m.text);
      tick.setAttribute('aria-label', `第 ${order + 1} 次提问：${summary(m.text)}`);
      tick.classList.toggle('active', active >= order && active < next);
      tick.onclick = () => this.onJump(m.id);
      this.ticks.append(tick);
    }
  }

  private renderRows(): void {
    const messages = this.index?.messages ?? [];
    const [start, end] = windowRange(messages.length, this.list.scrollTop, this.list.clientHeight || 190);
    const focused = this.shadow.activeElement?.getAttribute('data-message-id');
    if (focused) this.focusedId = focused;
    this.rows.style.transform = `translateY(${start * 38}px)`;
    this.rows.replaceChildren();
    if (!messages.length) {
      this.rows.append(node('div', 'empty', '等待当前对话中的提问…'));
      return;
    }
    for (let i = start; i < end; i++) {
      const m = messages[i];
      const row = node('button', 'row');
      row.dataset.messageId = m.id;
      row.title = m.text;
      row.setAttribute('aria-label', `第 ${i + 1} 次提问：${summary(m.text)}`);
      if (m.id === this.activeId) {
        row.classList.add('active');
        row.setAttribute('aria-current', 'location');
      }
      row.append(node('span', 'text', summary(m.text)), node('span', 'dash'));
      row.onclick = () => this.onJump(m.id);
      this.rows.append(row);
      if (focused === m.id) row.focus({ preventScroll: true });
    }
  }

  private keydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const messages = this.index?.messages ?? [];
    if (!messages.length) return;
    event.preventDefault();
    const focused = this.shadow.activeElement?.getAttribute('data-message-id') ?? this.focusedId ?? this.activeId;
    let order = Math.max(0, messages.findIndex(m => m.id === focused));
    if (event.key === 'Home') order = 0;
    else if (event.key === 'End') order = messages.length - 1;
    else order = Math.max(0, Math.min(messages.length - 1, order + (event.key === 'ArrowDown' ? 1 : -1)));
    const id = messages[order].id;
    this.focusedId = id;
    this.list.scrollTop = Math.max(0, order * 38 - (this.list.clientHeight || 190) / 2);
    this.renderRows();
    [...this.rows.querySelectorAll<HTMLButtonElement>('button')].find(b => b.dataset.messageId === id)?.focus({ preventScroll: true });
  }
}
