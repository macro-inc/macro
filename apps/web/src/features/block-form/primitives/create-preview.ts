import { ResultAsync } from 'neverthrow';
import { createSignal, onCleanup } from 'solid-js';
import type { FormWriteFailure } from '../context/form-context';

/** A tab reserved during the click, before the form is ready to preview. */
export type PreviewTab = {
  show: (url: string) => void;
  close: () => void;
};

type Flush = () => ResultAsync<void, FormWriteFailure>;

/**
 * Preview reads the form as respondents would, so it opens only once every
 * edit reached the server: column and metadata writes first, then the shared
 * layout, published. The tab is reserved during the click, where the browser
 * still allows it, and closed again when a write could not land.
 */
export function createPreview(options: {
  /** Opens a placeholder tab; `undefined` when the browser refused. */
  reserveTab: () => PreviewTab | undefined;
  url: () => string;
  notify: { failure: (message: string) => void };
}) {
  const [opening, setOpening] = createSignal(false);
  const writes = new Set<Flush>();
  const layouts = new Set<Flush>();

  /** Registers `flush` while the calling owner lives. */
  const track = (flushes: Set<Flush>, flush: Flush) => {
    flushes.add(flush);
    onCleanup(() => flushes.delete(flush));
  };

  const flushAll = (flushes: Set<Flush>) =>
    ResultAsync.combine([...flushes].map((flush) => flush())).map(
      () => undefined
    );

  async function open() {
    if (opening()) return;
    const tab = options.reserveTab();
    if (!tab) {
      options.notify.failure('Allow pop-ups to open the preview.');
      return;
    }
    setOpening(true);
    const landed = await flushAll(writes).andThen(() => flushAll(layouts));
    setOpening(false);
    landed.match(
      () => tab.show(options.url()),
      (failure) => {
        tab.close();
        options.notify.failure(`The preview wasn’t opened: ${failure.message}`);
      }
    );
  }

  return {
    /** Column and metadata writes a preview waits for. */
    trackWrites: (flush: Flush) => track(writes, flush),
    /** The shared layout, flushed and published after those writes. */
    trackLayout: (flush: Flush) => track(layouts, flush),
    open,
    opening,
  };
}

export type Preview = ReturnType<typeof createPreview>;
