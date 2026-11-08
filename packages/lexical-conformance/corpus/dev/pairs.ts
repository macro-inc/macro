import { nodes, object } from './scan';

/** Literal JSON edits exercise gate security without executing either implementation. */
export function gatePairs(state: unknown) {
  const pairs: { kind: string; after: unknown }[] = [
    { kind: 'unchanged', after: structuredClone(state) },
  ];
  const edit = (kind: string, apply: (copy: unknown) => boolean) => {
    const copy = structuredClone(state);
    if (apply(copy)) pairs.push({ kind, after: copy });
  };
  edit('character', (copy) => {
    const text = nodes(copy).find(
      (node) => typeof node.text === 'string' && node.type === 'text'
    );
    if (!text) return false;
    text.text = String(text.text) + 'x';
    return true;
  });
  edit('format', (copy) => {
    const text = nodes(copy).find(
      (node) => node.type === 'text' && typeof node.format === 'number'
    );
    if (!text || typeof text.format !== 'number') return false;
    text.format ^= 1;
    return true;
  });
  edit('move-block', (copy) => {
    if (
      !object(copy) ||
      !object(copy.root) ||
      !Array.isArray(copy.root.children) ||
      copy.root.children.length < 2
    )
      return false;
    copy.root.children.reverse();
    return true;
  });
  edit('language', (copy) => {
    const code = nodes(copy).find(
      (node) => node.type === 'code' || node.type === 'custom-code'
    );
    if (!code) return false;
    code.language = code.language === 'js' ? 'rust' : 'js';
    return true;
  });
  edit('replacement', (copy) => {
    const legacy = nodes(copy).find(
      (node) => node.type === 'code' || node.type === 'list'
    );
    if (!legacy) return false;
    legacy.type = legacy.type === 'code' ? 'custom-code' : 'task-list';
    return true;
  });
  edit('unwrap', (copy) => {
    for (const parent of nodes(copy)) {
      if (!Array.isArray(parent.children)) continue;
      const index = parent.children.findIndex(
        (child) =>
          object(child) &&
          child.type === 'comment-mark' &&
          Array.isArray(child.children)
      );
      if (index < 0) continue;
      const mark = parent.children[index];
      if (!object(mark) || !Array.isArray(mark.children)) return false;
      parent.children.splice(index, 1, ...mark.children);
      return true;
    }
    return false;
  });
  edit('draft-character', (copy) => {
    const draft = nodes(copy).find(
      (node) => node.type === 'comment-mark' && node.isDraft === true
    );
    const text =
      draft &&
      nodes(draft).find(
        (node) => node.type === 'text' && typeof node.text === 'string'
      );
    if (!text) return false;
    text.text = String(text.text) + 'x';
    return true;
  });
  for (const [kind, split, draft, unchecked] of [
    ['wrap', false, false, false],
    ['wrap-split', true, false, false],
    ['wrap-draft', false, true, false],
    ['wrap-list-unchecked', false, false, true],
  ] as const)
    edit(kind, (copy) => {
      for (const parent of nodes(copy)) {
        if (!Array.isArray(parent.children)) continue;
        if (
          unchecked &&
          (parent.type !== 'listitem' || parent.checked !== false)
        )
          continue;
        const index = parent.children.findIndex(
          (child) =>
            object(child) &&
            child.type === 'text' &&
            typeof child.text === 'string' &&
            Array.from(child.text).length >= 2 &&
            (!split || (typeof child.format === 'number' && child.format !== 0))
        );
        if (index < 0) continue;
        const text = parent.children[index];
        if (!object(text) || typeof text.text !== 'string') return false;
        const offset = (text.text.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
        const selected = {
          ...text,
          ...(split ? { text: text.text.slice(offset) } : {}),
        };
        const mark = {
          type: 'comment-mark',
          version: 1,
          children: [selected],
          ids: ['corpus-mark'],
          threadId: 1,
          isDraft: draft,
          direction: null,
          format: '',
          indent: 0,
        };
        parent.children.splice(
          index,
          1,
          ...(split
            ? [{ ...text, text: text.text.slice(0, offset) }, mark]
            : [mark])
        );
        return true;
      }
      return false;
    });
  return pairs;
}
