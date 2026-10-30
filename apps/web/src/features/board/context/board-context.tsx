import {
  type Accessor,
  type Component,
  createContext,
  useContext,
} from 'solid-js';
import type { BoardAuthor, BoardItem } from '../core/item';

export type BoardSourceState = 'loading' | 'error' | 'ready';

/** Earlier activity the host can fetch, for lists that scroll back in time. */
export type BoardOlderActivity = {
  hasMore: Accessor<boolean>;
  loading: Accessor<boolean>;
  load: () => void;
};

/** What the board shows, kept current by the host. */
export type BoardSource = {
  items: Accessor<readonly BoardItem[]>;
  state: Accessor<BoardSourceState>;
  retry: () => void;
  /** Absent when the host has nothing older to offer. */
  older?: BoardOlderActivity;
};

/** Where the board keeps its per-viewer layout and lifecycle memory. */
export type BoardStorage = {
  read: () => unknown;
  write: (value: unknown) => void;
};

/**
 * The capabilities the board reads the same way on every surface. The app
 * supplies them from Home's feed and split layout (`board.tsx`); the browser
 * fixture supplies sample conversations. Nothing under `primitives/`,
 * `components/` or `views/` reaches the app directly.
 */
export type BoardCapabilities = {
  source: BoardSource;
  /** Ticks so freshness and relative times move; fixtures freeze it. */
  now: Accessor<number>;
  storage: BoardStorage;
  /** A face for an author: profile picture, initials, or agent mark. */
  Avatar: Component<{ author: BoardAuthor; size: number }>;
  /** The item's real content, rendered inside the board's modal. */
  Detail: Component<{ itemKey: string }>;
  /**
   * The viewer opened an item. `modal` shows it over the board; `elsewhere`
   * means the host took them to it (it is open in another split, or it is a
   * kind the modal cannot show).
   */
  open: (itemKey: string) => 'modal' | 'elsewhere';
  /** The item's modal closed. */
  close: (itemKey: string) => void;
  /** Leaves the board for the item in a split. */
  openInSplit: (itemKey: string, options: { newSplit: boolean }) => void;
};

const BoardContext = createContext<BoardCapabilities>();

export const BoardProvider = BoardContext.Provider;

export function useBoard(): BoardCapabilities {
  const board = useContext(BoardContext);
  if (!board) throw new Error('Board views need a <BoardProvider>.');
  return board;
}
