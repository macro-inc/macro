import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type {
  ChangesSource,
  PatchRead,
  QueryStatus,
} from '../context/agent-changes-context';
import type { SessionChanges } from '../core/changeset';
import { createChangesModel } from './create-changes-model';

const PATCH = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-x
+y
`;

function summaryWith(
  files: string[],
  patchBytes = PATCH.length
): SessionChanges {
  return {
    capturing: false,
    changeset: {
      id: 'cs',
      base: { name: 'main' },
      head: { name: 'agent/x' },
      files: files.map((path) => ({
        path,
        kind: 'modified',
        additions: 1,
        deletions: 1,
        binary: false,
        patchOmitted: false,
      })),
      additions: files.length,
      deletions: files.length,
      patchBytes,
      truncated: false,
      capturedAt: 't',
    },
  };
}

function setup() {
  const [summary, setSummary] = createSignal<SessionChanges>();
  const [patchText, setPatchText] = createSignal<string>();
  const [patchStatus, setPatchStatus] = createSignal<QueryStatus>('idle');
  const [visible, setVisible] = createSignal(false);
  const enabledReads: boolean[] = [];
  let refreshes = 0;
  const source: ChangesSource = {
    summary,
    summaryStatus: () => (summary() ? 'success' : 'pending'),
    patch: (_changesetId, enabled): PatchRead => {
      // Model the query: it only has text once enabled.
      return {
        text: () => {
          enabledReads.push(enabled());
          return enabled() ? patchText() : undefined;
        },
        status: patchStatus,
        retry: () => {},
      };
    },
    refresh: async () => {
      refreshes += 1;
    },
  };
  const model = createChangesModel({ source, changesVisible: visible });
  return {
    model,
    setSummary,
    setPatchText,
    setPatchStatus,
    setVisible,
    refreshes: () => refreshes,
    enabledReads,
  };
}

describe('createChangesModel', () => {
  it('derives the state and files, and reads the patch once the pane shows', () => {
    // Mutations run outside the root body, as event handlers would, so
    // every derived value settles synchronously before it is read.
    const { model, setSummary, setPatchText, setVisible, dispose } = createRoot(
      (dispose) => ({ ...setup(), dispose })
    );
    expect(model.state().kind).toBe('loading');
    expect(model.patch()).toBe('');

    setSummary(summaryWith(['a.ts']));
    expect(model.state().kind).toBe('ready');
    expect(model.files().map((file) => file.path)).toEqual(['a.ts']);
    // Closed pane: the patch is not read yet.
    expect(model.patch()).toBeUndefined();

    setVisible(true);
    setPatchText(PATCH);
    expect(model.patch()).toBe(PATCH);
    dispose();
  });

  it('retains displayed patch text on close without further reads and clears it for another changeset', () => {
    const {
      model,
      setSummary,
      setPatchText,
      setVisible,
      enabledReads,
      dispose,
    } = createRoot((dispose) => ({ ...setup(), dispose }));
    setSummary(summaryWith(['a.ts']));
    setVisible(true);
    setPatchText(PATCH);
    expect(model.patch()).toBe(PATCH);
    const reads = enabledReads.length;
    setVisible(false);
    expect(model.patch()).toBe(PATCH);
    setPatchText('next patch');
    expect(model.patch()).toBe(PATCH);
    expect(enabledReads).toHaveLength(reads);
    const next = summaryWith(['b.ts']);
    next.changeset!.id = 'cs-next';
    setSummary(next);
    expect(model.patch()).toBeUndefined();
    setVisible(true);
    expect(model.patch()).toBe('next patch');
    dispose();
  });
  it('does not wait for a patch that has no bytes', () => {
    createRoot((dispose) => {
      const { model, setSummary, setVisible } = setup();
      setVisible(true);
      setSummary(summaryWith(['img.png'], 0));
      expect(model.patch()).toBe('');
      dispose();
    });
  });

  it('keeps the previous changeset on screen while a capture runs', () => {
    createRoot((dispose) => {
      const { model, setSummary } = setup();
      const ready = summaryWith(['a.ts']);
      setSummary(ready);
      setSummary({ ...ready, capturing: true });
      expect(model.state().kind).toBe('capturing');
      expect(model.changeset()?.id).toBe('cs');
      dispose();
    });
  });

  it('refreshes once at a time', async () => {
    await createRoot(async (dispose) => {
      const { model, refreshes } = setup();
      await Promise.all([model.refresh(), model.refresh()]);
      expect(refreshes()).toBe(1);
      expect(model.refreshing()).toBe(false);
      dispose();
    });
  });
});
