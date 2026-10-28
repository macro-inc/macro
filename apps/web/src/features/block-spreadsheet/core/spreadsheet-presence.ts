import type { SpreadsheetSelection } from './spreadsheet-document';

export type SpreadsheetPeer = {
  peerId: string;
  userId?: string;
  name?: string;
  color: string;
  selection: SpreadsheetSelection;
};

import { type CellSelection, positionFromAddress } from './grid-selection';

const colors = [
  'blue',
  'green',
  'purple',
  'pink',
  'teal',
  'orange',
  'red',
  'cyan',
  'violet',
  'lime',
  'yellow',
];

export type SpreadsheetCursor = {
  peerId: string;
  name: string;
  color: string;
  selection: CellSelection;
};

/** One overlay per peer, never a per-cell expansion of a remote range. */
export function spreadsheetCursors(
  peers: SpreadsheetPeer[],
  rowCount: number
): SpreadsheetCursor[] {
  const used = new Set<string>();
  return [...peers]
    .sort((a, b) => a.peerId.localeCompare(b.peerId))
    .flatMap((peer) => {
      const anchor = positionFromAddress(peer.selection.anchor);
      const focus = positionFromAddress(peer.selection.focus);
      if (!anchor || !focus || anchor.row >= rowCount || focus.row >= rowCount)
        return [];
      const preferred = colors.includes(peer.color) ? peer.color : 'blue';
      const color = used.has(preferred)
        ? (colors.find((item) => !used.has(item)) ?? preferred)
        : preferred;
      used.add(color);
      return [
        {
          peerId: peer.peerId,
          name:
            peer.name ||
            peer.userId?.replace(/^macro\|/, '').split('@')[0] ||
            'Anonymous',
          color: `var(--color-${color})`,
          selection: { anchor, focus },
        },
      ];
    });
}
