// C-TOUCH-CARET-MODE-01 part B: the one seed both caret pages load.
// P1: "Before " + an ordinary comment mark ['mark-a'] around "marked" + " after".
// P2: a line that STARTS with an ordinary comment mark ['mark-b'] around "Lead".
// P3: an id-less comment mark around "bare" (no thread is ever paired with it).
// Then a horizontal rule, the NodeSelection target of the model-not-DOM row.

const text = (value: string) => ({
  type: 'text',
  version: 1,
  text: value,
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
});
const mark = (ids: string[], value: string) => ({
  type: 'comment-mark',
  version: 1,
  ids,
  isDraft: false,
  direction: null,
  format: '',
  indent: 0,
  children: [text(value)],
});
const paragraph = (children: unknown[]) => ({
  type: 'paragraph',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  textStyle: '',
  children,
});

export const caretSeed = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    direction: null,
    format: '',
    indent: 0,
    children: [
      paragraph([text('Before '), mark(['mark-a'], 'marked'), text(' after')]),
      paragraph([mark(['mark-b'], 'Lead'), text(' text')]),
      paragraph([mark([], 'bare')]),
      { type: 'horizontalrule', version: 1 },
    ],
  },
});

const params = new URLSearchParams(location.search);
/** `thread`: the test-owned highlighted thread, paired with the ordinary marks. */
export const caretThreads: string[] = params.has('thread') ? ['t1'] : [];
export const caretReadOnly = params.has('readonly');

/** One engine-neutral description of a selection point. */
export type CaretPoint = {
  type: 'text' | 'element';
  node: string;
  /** The point node's parent type (the Source $getMarkIdsAtCaret input). */
  parent: string;
  text: string | null;
  offset: number;
};
/** One engine-neutral selection fact. */
export type CaretSelection =
  | { kind: 'range'; anchor: CaretPoint; focus: CaretPoint }
  | { kind: 'node'; nodes: string[] }
  | { kind: string };
