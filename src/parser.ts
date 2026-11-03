import type { ConversationIndex, MessageRef, TimelineRef } from './types';

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function messageText(message: RecordValue): string {
  const content = record(message.content) ? message.content : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const texts = parts.flatMap((part: unknown): string[] => {
    if (typeof part === 'string') return [part];
    if (!record(part)) return [];
    if (typeof part.text === 'string') return [part.text];
    if (part.content_type === 'image_asset_pointer') return ['[图片]'];
    if (String(part.content_type ?? '').includes('audio')) return ['[语音]'];
    return [];
  });
  if (!texts.length && typeof content.text === 'string') texts.push(content.text);
  const metadata = record(message.metadata) ? message.metadata : {};
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  if (!texts.some(t => t.trim())) {
    for (const a of attachments) {
      if (record(a) && typeof a.name === 'string') texts.push(`[附件：${a.name}]`);
    }
  }
  // Bound the bridge payload; never include asset URLs, metadata, or assistant bodies.
  return texts.join('\n').trim().slice(0, 16_000) || '（附件消息）';
}

/** Reject unknown schemas rather than guessing the selected branch. */
export function parseConversation(value: unknown, expectedId: string): ConversationIndex | null {
  if (!record(value)) return null;
  let data = value;
  if (!record(data.mapping)) {
    if (record(data.conversation)) data = data.conversation;
    else if (record(data.data)) data = data.data;
  }
  if (!record(data.mapping) || typeof data.current_node !== 'string') return null;
  const providedId = data.conversation_id ?? data.id;
  if (providedId != null && providedId !== expectedId) return null;
  const mapping = data.mapping;
  const chain: RecordValue[] = [];
  const visited = new Set<string>();
  let cursor: unknown = data.current_node;
  let complete = true;
  while (typeof cursor === 'string') {
    if (visited.has(cursor) || !record(mapping[cursor])) return null;
    visited.add(cursor);
    const node = mapping[cursor] as RecordValue;
    chain.push(node);
    if (node.parent != null && typeof node.parent !== 'string') return null;
    cursor = node.parent;
  }
  if (!chain.length) return null;
  if (data.has_more === true || data.is_partial === true || data.has_more_messages === true) complete = false;
  const messages: MessageRef[] = [];
  const timeline: TimelineRef[] = [];
  const ids = new Set<string>();
  let userId: string | null = null;
  for (const node of chain.reverse()) {
    if (!record(node.message)) continue;
    const message = node.message;
    const id = typeof message.id === 'string' ? message.id : node.id;
    if (typeof id !== 'string' || ids.has(id)) return null;
    ids.add(id);
    const author = record(message.author) ? message.author : {};
    if (author.role === 'user') {
      userId = id;
      messages.push({ id, text: messageText(message), order: messages.length, source: 'data' });
    }
    timeline.push({ id, userId });
  }
  return {
    conversationId: expectedId, branchId: data.current_node,
    completeness: complete ? 'complete' : 'partial', messages, timeline,
  };
}

/** Validate the untrusted cross-world event again in the isolated content script. */
export function validateIndex(value: unknown, expectedId: string): value is ConversationIndex {
  if (!record(value) || value.conversationId !== expectedId ||
      !(value.branchId === null || typeof value.branchId === 'string') ||
      !['complete', 'partial'].includes(String(value.completeness)) ||
      !Array.isArray(value.messages) || value.messages.length > 50_000 ||
      !Array.isArray(value.timeline) || value.timeline.length > 100_000) return false;
  const ids = new Set<string>();
  for (const [order, m] of value.messages.entries()) {
    if (!record(m) || typeof m.id !== 'string' || !m.id || m.id.length > 512 || ids.has(m.id) ||
        typeof m.text !== 'string' || m.text.length > 16_000 || m.order !== order || m.source !== 'data') return false;
    ids.add(m.id);
  }
  return value.timeline.every(t => record(t) && typeof t.id === 'string' &&
    (t.userId === null || (typeof t.userId === 'string' && ids.has(t.userId))));
}
