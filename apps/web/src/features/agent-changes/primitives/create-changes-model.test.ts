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
    draftPullRequest: async () => ({ title: '', body: '' }),
  };
  const model = createChangesModel({ source, changesVisible: visible });
  return {
    model,
    setSummary,
    setPatchText,
    setPatchStatus,
    setVisible,
    refreshes: () => refreshes,
  };
}

describe('createChangesModel', () => {
  it('derives the state, tree, and entries once the patch arrives', () => {
    // Mutations run outside the root body, as event handlers would, so
    // every derived value settles synchronously before it is read.
    const { model, setSummary, setPatchText, setVisible, dispose } = createRoot(
      (dispose) => ({ ...setup(), dispose })
    );
    expect(model.state().kind).toBe('loading');
    expect(model.entries()).toEqual([]);

    setSummary(summaryWith(['a.ts']));
    expect(model.state().kind).toBe('ready');
    expect(model.tree().map((node) => node.name)).toEqual(['a.ts']);
    // Closed pane: no patch, so no entries yet.
    expect(model.entries()).toBeUndefined();

    setVisible(true);
    setPatchText(PATCH);
    const entries = model.entries();
    expect(entries).toHaveLength(1);
    expect(entries?.[0]?.diff?.name).toBe('a.ts');
    dispose();
  });

  it('does not wait for a patch that has no bytes', () => {
    createRoot((dispose) => {
      const { model, setSummary, setVisible } = setup();
      setVisible(true);
      setSummary(summaryWith(['img.png'], 0));
      const entries = model.entries();
      expect(entries).toHaveLength(1);
      expect(entries?.[0]?.note).toBe('No diff text for this file');
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
