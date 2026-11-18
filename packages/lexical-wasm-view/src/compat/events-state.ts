/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey } from 'lexical';
import type { RangeSelection } from './runtime';

class State {
  lastKeyDownTimeStamp = 0;
  lastKeyCode: null | string = null;
  lastBeforeInputInsertTextTimeStamp = 0;
  unprocessedBeforeInputData: null | string = null;
  isInsertTextAfterHandledSelectionCommand = false;
  handledSelectionCommandTimeoutId: null | ReturnType<typeof setTimeout> = null;
  isSelectionChangeFromDOMUpdate = false;
  isSelectionChangeFromMouseDown = false;
  isInsertLineBreak = false;
  isFirefoxEndingComposition = false;
  isSafariEndingComposition = false;
  safariEndCompositionEventData = '';
  postDeleteSelectionToRestore: RangeSelection | null = null;
  collapsedSelectionFormat: [number, string, number, NodeKey, number] = [
    0,
    '',
    0,
    'root',
    0,
  ];
}
export let eventsState = new State();
