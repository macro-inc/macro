import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import { installCodeHighlighting } from '../src/view/code-highlight';
import type { EditorView } from '../src/view/editor-view';
import type { EditorPort } from '../src/view/port';
import { getTableObserverFromTableElement } from '../src/view/table/observer';

export async function commitWork(
  view: EditorView,
  port: EditorPort,
  size: number
) {
  const text = (value: string) => ({ type: 'text', version: 1, text: value });
  port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          ...Array.from({ length: size }, (_, i) => ({
            type: 'paragraph',
            version: 1,
            children: [
              {
                type: 'mark',
                version: 1,
                ids: [`mark-${i}`],
                children: [text(`comment ${i}`)],
              },
            ],
          })),
          {
            type: 'table',
            version: 1,
            children: Array.from({ length: size }, (_, y) => ({
              type: 'tablerow',
              version: 1,
              children: [0, 1].map((x) => ({
                type: 'tablecell',
                version: 1,
                colSpan: 1,
                rowSpan: 1,
                headerState: 0,
                children: [
                  {
                    type: 'paragraph',
                    version: 1,
                    children: [text(`cell ${y} ${x}`)],
                  },
                ],
              })),
            })),
          },
          ...Array.from({ length: size }, (_, i) => ({
            type: 'code',
            version: 1,
            language: 'javascript',
            children: [text(`const value${i} = 1;`)],
          })),
        ],
      },
    })
  );
  const targets = new Map(
    [...view.mirror.values()]
      .filter((node) => node.kind === 'text')
      .map((node) => [node.text, node.key])
  );
  const codes = [
    ...view.root.querySelectorAll('code[data-highlight-language]'),
  ];
  for (const code of codes)
    if (code instanceof HTMLElement) code.style.display = 'block';
  const margin = document.createElement('div');
  margin.style.cssText =
    'position:absolute;left:1000px;top:0;width:200px;height:100px';
  document.body.append(margin);
  const marks = [...view.root.querySelectorAll('mark')].filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  );
  const positions = new Map<string, number>();
  let markReads = 0,
    rangeInputs = 0;
  const bounds = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this.tagName === 'MARK') markReads++;
    return bounds.call(this);
  };
  const OriginalHighlight = window.Highlight;
  class MeasuredHighlight extends OriginalHighlight {
    constructor(...ranges: AbstractRange[]) {
      rangeInputs += ranges.length;
      super(...ranges);
    }
    override add(range: AbstractRange): this {
      rangeInputs++;
      return super.add(range);
    }
    override delete(range: AbstractRange): boolean {
      rangeInputs++;
      return super.delete(range);
    }
  }
  window.Highlight = MeasuredHighlight;
  let geometryReady = () => {};
  const ready = new Promise<void>((resolve) => {
    geometryReady = resolve;
  });
  let shiftedReady = () => {};
  let shifted = false;
  const geometry = view.observeMarkGeometry<string>(margin, (id, top) => {
    positions.set(id, top);
    if (positions.size === marks.length) geometryReady();
    if (shifted && id === `mark-${size - 1}`) shiftedReady();
  });
  geometry.setMarks(new Map(marks.map((el, i) => [`mark-${i}`, [el]])));
  const pending = new Set(codes);
  let painted = () => {};
  const paintReady = new Promise<void>((resolve) => {
    painted = resolve;
  });
  const observer = new MutationObserver((records) => {
    for (const record of records)
      if (record.target instanceof Element) pending.delete(record.target);
    if (!pending.size) painted();
  });
  observer.observe(view.root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-line-count'],
  });
  const disposeHighlight = installCodeHighlighting(view);
  try {
    await Promise.all([ready, paintReady]);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    function select(value: string) {
      const key = targets.get(value);
      const node = key === undefined ? null : view.node(key);
      if (!node) throw new Error('Missing native edit target');
      port.selectionFromView({
        kind: 'range',
        anchor: {
          key: node.key,
          type: 'text',
          offset: Math.min(1, node.text.length),
        },
        focus: {
          key: node.key,
          type: 'text',
          offset: Math.min(1, node.text.length),
        },
      });
    }
    function insert(value: string) {
      select(value);
      port.command(CommandCode.InsertText, 0, 0, '!');
    }
    markReads = 0;
    let edited = () => {};
    const editedMark = new Promise<void>((resolve) => {
      edited = resolve;
    });
    geometryReady = edited;
    insert('comment 0');
    await editedMark;
    const commentReads = markReads;
    const commentTop = positions.get('mark-0');
    const actualTop = bounds.call(marks[0]).top - bounds.call(margin).top;
    const table = view.root.querySelector('table');
    if (!table) throw new Error('Missing native table');
    const tableObserver = getTableObserverFromTableElement(table);
    if (!tableObserver) throw new Error('Missing native table observer');
    const grid = tableObserver.getGrid();
    tableObserver.select(grid[0][0].key, grid[0][1].key);
    let tableWrites = 0;
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLTableCellElement) tableWrites++;
      return setAttribute.call(this, name, value);
    };
    try {
      insert(`cell ${size - 1} 0`);
    } finally {
      Element.prototype.setAttribute = setAttribute;
    }
    const selectionIntact =
      table.querySelectorAll('[data-lexical-table-selected]').length === 2;
    rangeInputs = 0;
    pending.clear();
    pending.add(codes[0]);
    const codeReady = new Promise<void>((resolve) => {
      painted = resolve;
    });
    const untouched = window.CSS.highlights.get(
      `code-${view.options.namespace}-keyword`
    );
    const oldRange = untouched
      ? [...untouched].find(
          (range) =>
            range.startContainer.parentElement?.closest('code') ===
            codes[size - 1]
        )
      : undefined;
    insert('const value0 = 1;');
    await codeReady;
    const codeRangeInputs = rangeInputs;
    const retained =
      !!oldRange &&
      !!window.CSS.highlights
        .get(`code-${view.options.namespace}-keyword`)
        ?.has(oldRange);
    markReads = 0;
    const shiftReady = new Promise<void>((resolve) => {
      shiftedReady = resolve;
    });
    shifted = true;
    const first = marks[0].parentElement;
    if (!first) throw new Error('Missing marked block');
    first.style.height = '80px';
    await shiftReady;
    const movedLast = positions.get(`mark-${size - 1}`);
    const actualLast =
      bounds.call(marks[size - 1]).top - bounds.call(margin).top;
    const shiftedReads = markReads;
    const originalParagraph = view.registry.get('paragraph');
    const previousBlock = marks[0].parentElement;
    let replaced = () => {};
    const replacementReady = new Promise<void>((resolve) => {
      replaced = resolve;
    });
    shiftedReady = replaced;
    view.registry.replace('paragraph', {
      ...originalParagraph,
      updateDOM: () => true,
    });
    try {
      select('comment 0');
      port.command(CommandCode.FormatElement, 2);
      await replacementReady;
    } finally {
      view.registry.replace('paragraph', originalParagraph);
    }
    const rebound = marks[0].parentElement !== previousBlock;
    const replacementLast = positions.get(`mark-${size - 1}`);
    const replacementActual =
      bounds.call(marks[size - 1]).top - bounds.call(margin).top;
    const nextReady = new Promise<void>((resolve) => {
      geometryReady = resolve;
    });
    insert('comment 0');
    await nextReady;
    const reboundTop = positions.get('mark-0');
    const reboundActual = bounds.call(marks[0]).top - bounds.call(margin).top;
    return {
      size,
      replacementLast,
      replacementActual,
      rebound,
      reboundTop,
      reboundActual,
      commentReads,
      commentTop,
      actualTop,
      tableWrites,
      selectionIntact,
      codeRangeInputs,
      retained,
      shiftedReads,
      movedLast,
      actualLast,
      empty: view.isEmpty(),
    };
  } finally {
    observer.disconnect();
    geometry.dispose();
    disposeHighlight();
    margin.remove();
    Element.prototype.getBoundingClientRect = bounds;
    window.Highlight = OriginalHighlight;
  }
}
