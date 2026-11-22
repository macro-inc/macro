/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. LexicalEvents.ts:285-327, Lexical 0.45.0,
 * 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */

type DOMPoint = { nodeType: number; nodeValue: string | null } | null;

/** Test raw DOM endpoints before model point normalization. */
export function shouldSkipDOMSelectionChange(
  fromDOMUpdate: boolean,
  anchor: DOMPoint,
  anchorOffset: number,
  focus: DOMPoint,
  focusOffset: number,
  postDeleteRestore: boolean
): boolean {
  return (
    fromDOMUpdate &&
    anchor?.nodeType === 3 &&
    anchor.nodeValue !== null &&
    anchorOffset !== 0 &&
    anchorOffset !== anchor.nodeValue.length &&
    focus?.nodeType === 3 &&
    focus.nodeValue !== null &&
    focusOffset !== 0 &&
    focusOffset !== focus.nodeValue.length &&
    !postDeleteRestore
  );
}

// Upstream owns one module-wide flag, shared across editors and documents. Root
// replacement/disposal does not clear it; only the next selection handler does.
let selectionChangeFromDOMUpdate = false;

export function markSelectionChangeFromDOMUpdate(): void {
  selectionChangeFromDOMUpdate = true;
}

export function consumeSelectionChangeFromDOMUpdate(
  selection: Selection | null,
  postDeleteRestore: boolean
): boolean {
  const fromDOMUpdate = selectionChangeFromDOMUpdate;
  selectionChangeFromDOMUpdate = false;
  return shouldSkipDOMSelectionChange(
    fromDOMUpdate,
    selection?.anchorNode ?? null,
    selection?.anchorOffset ?? 0,
    selection?.focusNode ?? null,
    selection?.focusOffset ?? 0,
    postDeleteRestore
  );
}
