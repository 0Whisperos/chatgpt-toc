import { type ConversationIndex, type MessageRef } from './types';

export function emptyIndex(conversationId: string): ConversationIndex {
  return { conversationId, branchId: null, completeness: 'partial', messages: [], timeline: [] };
}

/** Merge one rendered window without removing messages unmounted by virtualization. */
export function mergeDom(index: ConversationIndex, incoming: MessageRef[], direction: 'up' | 'down' = 'down'): ConversationIndex {
  if (!incoming.length) return index;
  let messages = index.messages.map(m => ({ ...m }));
  let completeness = index.completeness;
  let branchChanged = false;
  const known = new Map(messages.map((m, i) => [m.id, i]));
  const overlap = incoming.some(m => known.has(m.id));

  // An edited branch has a known prefix followed by replacement user IDs. Drop
  // the old suffix rather than presenting siblings as a single conversation.
  if (completeness === 'complete' || index.branchId !== null) {
    let previous = -1;
    for (const item of incoming) {
      const position = known.get(item.id);
      if (position != null) {
        previous = position;
      } else if (previous >= 0 && previous < messages.length - 1) {
        messages = messages.slice(0, previous + 1);
        completeness = 'partial';
        branchChanged = true;
        break;
      }
    }
    if (!overlap && incoming.length && messages.length) {
      // With no surviving anchor we cannot prove this is still the same branch.
      messages = [];
      completeness = 'partial';
      branchChanged = true;
    }
  }

  for (let i = 0; i < incoming.length; i++) {
    const item = incoming[i];
    const existing = messages.findIndex(m => m.id === item.id);
    if (existing >= 0) {
      // Prefer DOM for edits, while keeping richer attachment descriptions.
      const text = item.text === '（附件消息）' ? messages[existing].text : item.text;
      messages[existing] = { ...messages[existing], text };
      continue;
    }
    let before = -1;
    for (let j = i + 1; j < incoming.length; j++) {
      before = messages.findIndex(m => m.id === incoming[j].id);
      if (before >= 0) break;
    }
    if (before >= 0) messages.splice(before, 0, { ...item });
    else {
      const previous = i > 0 ? messages.findIndex(m => m.id === incoming[i - 1].id) : -1;
      if (previous >= 0) messages.splice(previous + 1, 0, { ...item });
      else if (direction === 'up') messages.unshift({ ...item });
      else messages.push({ ...item });
    }
  }
  const ids = new Set(messages.map(m => m.id));
  return { ...index, completeness,
    branchId: branchChanged ? null : index.branchId,
    timeline: index.timeline.filter(t => t.userId === null || ids.has(t.userId)),
    messages: messages.map((m, order) => ({ ...m, order })),
  };
}

export function windowRange(count: number, scrollTop: number, height: number, rowHeight = 38): [number, number] {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  return [Math.min(start, count), Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + 5)];
}
