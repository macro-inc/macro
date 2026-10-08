import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { FormWriteFailure } from '../context/form-context';
import { createPreview, type PreviewTab } from './create-preview';

/** A write the test answers by hand, recording when it was asked. */
function deferredWrite(name: string, events: string[]) {
  let settle: (result: Result<void, FormWriteFailure>) => void = () => {};
  let markAsked: () => void = () => {};
  const asked = new Promise<void>((resolve) => {
    markAsked = resolve;
  });
  const flush = () => {
    events.push(name);
    markAsked();
    return new ResultAsync(
      new Promise<Result<void, FormWriteFailure>>((resolve) => {
        settle = resolve;
      })
    );
  };
  return {
    flush,
    asked,
    settle: (result: Result<void, FormWriteFailure>) => settle(result),
  };
}

function fakeTab(events: string[]): PreviewTab {
  return {
    show: (url) => events.push(`show ${url}`),
    close: () => events.push('close'),
  };
}

const URL = 'https://macro.com/app/form/form-1/respond?preview=true';

describe('createPreview', () => {
  it('reserves the tab during the click, then shows the form once column and metadata writes landed and the layout was published', async () => {
    const events: string[] = [];
    const notices: string[] = [];
    await createRoot(async (dispose) => {
      const preview = createPreview({
        reserveTab: () => {
          events.push('reserve');
          return fakeTab(events);
        },
        url: () => URL,
        notify: { failure: (message) => notices.push(message) },
      });
      const columns = deferredWrite('columns', events);
      const metadata = deferredWrite('metadata', events);
      const layout = deferredWrite('layout', events);
      preview.trackLayout(layout.flush);
      preview.trackWrites(columns.flush);
      preview.trackWrites(metadata.flush);

      const opening = preview.open();
      expect(events).toEqual(['reserve', 'columns', 'metadata']);
      expect(preview.opening()).toBe(true);
      columns.settle(ok(undefined));
      await Promise.resolve();
      expect(events).toEqual(['reserve', 'columns', 'metadata']);
      metadata.settle(ok(undefined));
      await layout.asked;
      expect(events).toEqual(['reserve', 'columns', 'metadata', 'layout']);
      layout.settle(ok(undefined));
      await opening;
      expect(events).toEqual([
        'reserve',
        'columns',
        'metadata',
        'layout',
        `show ${URL}`,
      ]);
      expect(preview.opening()).toBe(false);
      expect(notices).toEqual([]);
      dispose();
    });
  });

  it('closes the reserved tab and says why when the layout could not be published', async () => {
    const events: string[] = [];
    const notices: string[] = [];
    await createRoot(async (dispose) => {
      const preview = createPreview({
        reserveTab: () => fakeTab(events),
        url: () => URL,
        notify: { failure: (message) => notices.push(message) },
      });
      const layout = deferredWrite('layout', events);
      preview.trackLayout(layout.flush);
      const opening = preview.open();
      await layout.asked;
      layout.settle(
        err({
          message: 'You’re offline. Your changes are kept on this device.',
        })
      );
      await opening;
      expect(events).toEqual(['layout', 'close']);
      expect(notices).toEqual([
        'The preview wasn’t opened: You’re offline. Your changes are kept on this device.',
      ]);
      dispose();
    });
  });

  it('never publishes the layout when a column or metadata write failed', async () => {
    const events: string[] = [];
    const notices: string[] = [];
    await createRoot(async (dispose) => {
      const preview = createPreview({
        reserveTab: () => fakeTab(events),
        url: () => URL,
        notify: { failure: (message) => notices.push(message) },
      });
      const metadata = deferredWrite('metadata', events);
      const layout = deferredWrite('layout', events);
      preview.trackLayout(layout.flush);
      preview.trackWrites(metadata.flush);
      const opening = preview.open();
      metadata.settle(err({ message: 'The description wasn’t saved.' }));
      await opening;
      expect(events).toEqual(['metadata', 'close']);
      expect(notices).toEqual([
        'The preview wasn’t opened: The description wasn’t saved.',
      ]);
      dispose();
    });
  });

  it('asks for pop-ups when no tab could be reserved, and ignores a second click while opening', async () => {
    const events: string[] = [];
    const notices: string[] = [];
    await createRoot(async (dispose) => {
      let blocked = true;
      const preview = createPreview({
        reserveTab: () => (blocked ? undefined : fakeTab(events)),
        url: () => URL,
        notify: { failure: (message) => notices.push(message) },
      });
      const layout = deferredWrite('layout', events);
      preview.trackLayout(layout.flush);
      await preview.open();
      expect(notices).toEqual(['Allow pop-ups to open the preview.']);
      expect(events).toEqual([]);
      blocked = false;
      const opening = preview.open();
      void preview.open();
      await layout.asked;
      expect(events).toEqual(['layout']);
      layout.settle(ok(undefined));
      await opening;
      expect(events).toEqual(['layout', `show ${URL}`]);
      dispose();
    });
  });

  it('forgets the writes of an editor that closed', async () => {
    const events: string[] = [];
    await createRoot(async (dispose) => {
      const preview = createPreview({
        reserveTab: () => fakeTab(events),
        url: () => URL,
        notify: { failure: () => {} },
      });
      createRoot((closeBuilder) => {
        preview.trackWrites(deferredWrite('columns', events).flush);
        closeBuilder();
      });
      await preview.open();
      expect(events).toEqual([`show ${URL}`]);
      dispose();
    });
  });
});
