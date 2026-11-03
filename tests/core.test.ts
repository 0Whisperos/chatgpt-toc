import { describe, expect, it } from 'vitest';
import { parseConversation, validateIndex } from '../src/parser';
import { emptyIndex, mergeDom, windowRange } from '../src/model';
import { conversationId, label, type MessageRef } from '../src/types';

function message(id: string, role = 'user', text = id) {
  return { id, author: { role }, content: { parts: [text] } };
}
function fixture() {
  return { conversation_id: 'abc', current_node: 'a-new', mapping: {
    root: { id: 'root', parent: null, message: null },
    u1: { id: 'u1', parent: 'root', message: message('u1', 'user', '重复提问') },
    a1: { id: 'a1', parent: 'u1', message: message('a1', 'assistant', 'private assistant body') },
    'u-old': { id: 'u-old', parent: 'a1', message: message('u-old', 'user', '旧分支') },
    'u-new': { id: 'u-new', parent: 'a1', message: message('u-new', 'user', '重复提问') },
    'a-new': { id: 'a-new', parent: 'u-new', message: message('a-new', 'assistant') },
  } };
}
function dom(...ids: string[]): MessageRef[] {
  return ids.map((id, order) => ({ id, text: id, order, source: 'dom' }));
}

describe('conversation parser', () => {
  it('uses only the selected branch, keeps duplicate prompts, associates assistant IDs', () => {
    const parsed = parseConversation(fixture(), 'abc')!;
    expect(parsed.completeness).toBe('complete');
    expect(parsed.messages.map(m => m.id)).toEqual(['u1', 'u-new']);
    expect(parsed.messages.map(m => m.text)).toEqual(['重复提问', '重复提问']);
    expect(parsed.timeline.at(-1)).toEqual({ id: 'a-new', userId: 'u-new' });
    expect(JSON.stringify(parsed)).not.toContain('private assistant body');
    expect(validateIndex(parsed, 'abc')).toBe(true);
  });
  it('supports wrappers and refuses another conversation', () => {
    expect(parseConversation({ conversation: fixture() }, 'abc')).not.toBeNull();
    expect(parseConversation({ data: fixture() }, 'abc')).not.toBeNull();
    expect(parseConversation(fixture(), 'other')).toBeNull();
  });
  it('rejects missing current nodes, broken chains, cycles and unknown schemas', () => {
    expect(parseConversation({ mapping: {} }, 'abc')).toBeNull();
    const broken = fixture();
    broken.mapping['u-new'].parent = 'missing';
    expect(parseConversation(broken, 'abc')).toBeNull();
    const cycle = fixture();
    cycle.mapping.u1.parent = 'a-new';
    expect(parseConversation(cycle, 'abc')).toBeNull();
    expect(parseConversation({ current_node: 'x', mapping: { x: { parent: 1 } } }, 'abc')).toBeNull();
  });
  it('does not label explicitly partial data as complete', () => {
    expect(parseConversation({ ...fixture(), has_more: true }, 'abc')?.completeness).toBe('partial');
  });
  it('uses safe attachment labels, never asset paths', () => {
    const data = fixture();
    Object.assign(data.mapping.u1.message.content, { parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'secret://image' }] });
    const parsed = parseConversation(data, 'abc')!;
    expect(parsed.messages[0].text).toBe('[图片]');
    expect(JSON.stringify(parsed)).not.toContain('secret://');
    Object.assign(data.mapping.u1.message, { content: { parts: [] }, metadata: { attachments: [{ name: 'report.pdf', url: 'secret' }] } });
    expect(parseConversation(data, 'abc')?.messages[0].text).toBe('[附件：report.pdf]');
  });
  it('rejects forged bridge payloads and excessive input', () => {
    const parsed = parseConversation(fixture(), 'abc')!;
    expect(validateIndex(parsed, 'different')).toBe(false);
    expect(validateIndex({ ...parsed, messages: [{ id: 'x', text: 42 }] }, 'abc')).toBe(false);
    expect(validateIndex({ ...parsed, messages: [parsed.messages[0], parsed.messages[0]] }, 'abc')).toBe(false);
    expect(validateIndex({ ...parsed, messages: [{ ...parsed.messages[0], text: 'x'.repeat(16_001) }] }, 'abc')).toBe(false);
  });
});

describe('index merging', () => {
  it('keeps unmounted messages, inserts overlapping windows in order', () => {
    let index = mergeDom(emptyIndex('abc'), dom('u3', 'u4'));
    index = mergeDom(index, dom('u1', 'u2', 'u3'), 'up');
    index = mergeDom(index, dom('u4', 'u5'));
    expect(index.messages.map(m => m.id)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
  });
  it('drops the old suffix when an edit creates a new branch', () => {
    const index = { ...emptyIndex('abc'), messages: dom('u1', 'u2', 'u3'), completeness: 'complete' as const };
    const merged = mergeDom(index, dom('u1', 'replacement'));
    expect(merged.messages.map(m => m.id)).toEqual(['u1', 'replacement']);
    expect(merged.completeness).toBe('partial');
  });
  it('does not guess the branch when all visible IDs were replaced', () => {
    const index = { ...emptyIndex('abc'), messages: dom('old'), completeness: 'complete' as const };
    expect(mergeDom(index, dom('new')).messages.map(m => m.id)).toEqual(['new']);
  });
  it('keeps partial API branch identity and removes its replaced suffix', () => {
    const parsed = parseConversation({ ...fixture(), has_more: true }, 'abc')!;
    const unchanged = mergeDom(parsed, [{ ...parsed.messages[0], source: 'dom' }]);
    expect(unchanged.branchId).toBe('a-new');
    const changed = mergeDom(unchanged, dom('u1', 'replacement'));
    expect(changed.messages.map(m => m.id)).toEqual(['u1', 'replacement']);
    expect(changed.branchId).toBeNull();
  });
  it('appends new messages without changing order or duplicates', () => {
    const index = { ...emptyIndex('abc'), messages: dom('u1', 'u2'), completeness: 'complete' as const };
    const merged = mergeDom(index, dom('u2', 'u3'));
    expect(merged.messages.map(m => [m.id, m.order])).toEqual([['u1', 0], ['u2', 1], ['u3', 2]]);
  });
});

describe('routing and virtual rows', () => {
  it('supports conversation paths including projects and excludes home/share paths', () => {
    expect(conversationId('/c/abc-def')).toBe('abc-def');
    expect(conversationId('/g/g-p-project/c/abc')).toBe('abc');
    expect(conversationId('/share/abc')).toBeNull();
    expect(conversationId('/')).toBeNull();
  });
  it('renders a bounded row window in a 300-entry list', () => {
    const [start, end] = windowRange(300, 150 * 38, 342);
    expect(start).toBe(145);
    expect(end - start).toBeLessThanOrEqual(20);
    expect(windowRange(0, 0, 342)).toEqual([0, 0]);
    expect(windowRange(300, 1e9, 342)).toEqual([300, 300]);
  });
  it('normalizes multiline prompt summaries', () => {
    expect(label('  第一行\n\t第二行 ')).toBe('第一行 第二行');
    expect(label('  ')).toBe('（附件消息）');
  });
});
