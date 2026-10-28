import type { SpreadsheetPeer } from '../core/spreadsheet-presence';

export type { SpreadsheetPeer } from '../core/spreadsheet-presence';

import type { LoroDoc } from 'loro-crdt';
import type { Accessor } from 'solid-js';
import type { SpreadsheetSelection } from '../core/spreadsheet-document';

export type SpreadsheetConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'local';

/** The editor owns cell operations; its host owns transport and persistence. */
export type SpreadsheetDocumentSource = {
  doc: Accessor<LoroDoc | undefined>;
  ready: Accessor<boolean>;
  error: Accessor<string | undefined>;
  status: Accessor<SpreadsheetConnectionStatus>;
  peers: Accessor<SpreadsheetPeer[]>;
  setSelection: (selection: SpreadsheetSelection | undefined) => void;
};
