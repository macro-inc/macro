import { type Fixture, fields } from './schema';

/** JSON does not retain allocation keys; partial fixtures carry their explicit layout. */
export function preorderKeys(state: object): string[] {
  const map = fields(state)._nodeMap;
  if (!(map instanceof Map)) throw new Error('Invalid initial node map');
  const keys: string[] = [];
  const visit = (key: string) => {
    keys.push(key);
    let child = map.get(key).__first;
    while (child) {
      visit(child);
      child = map.get(child).__next;
    }
  };
  visit('root');
  return keys;
}

export function restoreInitial(
  editor: object,
  initial: Fixture['initial'],
  lexical: Record<string, unknown>,
  utils: Record<string, unknown>
): void {
  const raw = fields(editor);
  if (typeof raw.parseEditorState !== 'function')
    throw new Error('Missing initial state parser');
  const parsed = fields(
    Reflect.apply(raw.parseEditorState, editor, [initial.editorState])
  );
  const before = preorderKeys(parsed);
  if (!initial.keys || initial.keys.length !== before.length)
    throw new Error('Initial key layout mismatch');
  const remap = new Map(before.map((key, i) => [key, initial.keys?.[i]]));
  const source = parsed._nodeMap;
  if (!(source instanceof Map)) throw new Error('Missing initial node map');
  const nodes = new Map();
  for (const [key, node] of source) {
    const clone = Object.assign(
      Object.create(Object.getPrototypeOf(node)),
      node
    );
    for (const field of [
      '__key',
      '__parent',
      '__first',
      '__last',
      '__prev',
      '__next',
    ])
      if (typeof clone[field] === 'string')
        clone[field] = remap.get(clone[field]) ?? clone[field];
    nodes.set(remap.get(key), clone);
  }
  parsed._nodeMap = new Map(
    (initial.nodeMapKeys ?? []).map((key) => {
      if (!nodes.has(key))
        throw new Error('Initial node map ordering mismatch');
      return [key, nodes.get(key)];
    })
  );
  if (initial.selection) {
    const value = fields(initial.selection);
    const create =
      lexical[
        value.type === 'range'
          ? '$createRangeSelection'
          : '$createNodeSelection'
      ];
    if (typeof create !== 'function')
      throw new Error('Unsupported initial selection');
    const selection = fields(create());
    if (value.type === 'range') {
      for (const side of ['anchor', 'focus']) {
        const point = fields(value[side]);
        Object.assign(fields(selection[side]), {
          key: point.key,
          offset: point.offset,
          type: point.type,
        });
      }
      selection.format = value.format;
      selection.style = value.style;
    } else if (value.type === 'node')
      selection._nodes = new Set(value.keys as string[]);
    else throw new Error('Unsupported initial selection');
    parsed._selection = selection;
  } else parsed._selection = null;
  raw._editorState = parsed;
  raw._pendingEditorState = null;
  if (
    typeof utils.setRecorderKeyCounter !== 'function' ||
    initial.nextKey === undefined
  )
    throw new Error('Missing initial key counter');
  utils.setRecorderKeyCounter(initial.nextKey);
}
