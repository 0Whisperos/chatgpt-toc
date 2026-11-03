export interface MessageRef {
  id: string;
  text: string;
  order: number;
  source: 'data' | 'dom';
}

export interface TimelineRef {
  id: string;
  userId: string | null;
}

export interface ConversationIndex {
  conversationId: string;
  branchId: string | null;
  completeness: 'complete' | 'partial';
  messages: MessageRef[];
  timeline: TimelineRef[];
}

export interface DomMessage extends MessageRef {
  element: HTMLElement;
  turn: HTMLElement;
}

export const SNAPSHOT_EVENT = 'chatgpt-toc:snapshot:v1';
export const READY_EVENT = 'chatgpt-toc:ready:v1';
export const MAX_BRIDGE_SIZE = 8_000_000;

export function conversationId(pathname: string): string | null {
  return pathname.match(/(?:^|\/)c\/([a-zA-Z0-9-]+)(?:\/|$)/)?.[1] ?? null;
}

export function label(text: string): string {
  return text.replace(/\s+/g, ' ').trim() || '（附件消息）';
}
