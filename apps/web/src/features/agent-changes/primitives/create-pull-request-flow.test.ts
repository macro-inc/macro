import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { Changeset } from '../core/changeset';
import { createPullRequestFlow } from './create-pull-request-flow';

const changeset: Changeset = {
  id: 'cs',
  repository: 'https://github.com/macro-inc/macro',
  base: { name: 'main' },
  head: { name: 'agent/x' },
  files: [],
  additions: 0,
  deletions: 0,
  patchBytes: 0,
  truncated: false,
  capturedAt: 't',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides: { canSend?: boolean } = {}) {
  const drafts: ReturnType<typeof deferred<{ title: string; body: string }>>[] =
    [];
  const sent: string[] = [];
  const notified: string[] = [];
  const opened: string[] = [];
  const [pullRequestUrl, setPullRequestUrl] = createSignal<string>();
  const ensureVisible = vi.fn();
  const flow = createPullRequestFlow({
    source: {
      draftPullRequest: () => {
        const next = deferred<{ title: string; body: string }>();
        drafts.push(next);
        return next.promise;
      },
    },
    host: {
      sendToAgent: (markdown) => void sent.push(markdown),
      canSend: () => overrides.canSend ?? true,
      pullRequestUrl,
      openExternal: (url) => void opened.push(url),
      notify: (message) => void notified.push(message),
    },
    changeset: () => changeset,
    ensureVisible,
  });
  return {
    flow,
    drafts,
    sent,
    notified,
    opened,
    setPullRequestUrl,
    ensureVisible,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPullRequestFlow', () => {
  it('quick: drafts, posts the prompt, and opens when the session links a PR', async () => {
    await createRoot(async (dispose) => {
      const { flow, drafts, sent, setPullRequestUrl, ensureVisible } = setup();
      flow.start('quick');
      expect(ensureVisible).toHaveBeenCalled();
      expect(flow.sheet()).toEqual({ kind: 'drafting', draft: false });
      expect(flow.busy()).toBe(true);

      drafts[0]!.resolve({ title: 'Fix it', body: 'Because.' });
      await flush();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain('Open a pull request');
      expect(sent[0]).toContain('- Title: Fix it');
      expect(flow.sheet().kind).toBe('creating');

      setPullRequestUrl('https://github.com/macro-inc/macro/pull/7');
      expect(flow.sheet()).toEqual({
        kind: 'opened',
        url: 'https://github.com/macro-inc/macro/pull/7',
        title: 'Fix it',
      });
      expect(flow.busy()).toBe(false);
      dispose();
    });
  });

  it('draft: asks for a draft pull request', async () => {
    await createRoot(async (dispose) => {
      const { flow, drafts, sent } = setup();
      flow.start('draft');
      drafts[0]!.resolve({ title: 'T', body: 'B' });
      await flush();
      expect(sent[0]).toContain('Open a draft pull request');
      dispose();
    });
  });

  it('edit: opens the form, fills it from the draft, and posts on submit', async () => {
    await createRoot(async (dispose) => {
      const { flow, drafts, sent } = setup();
      flow.start('edit');
      let sheet = flow.sheet();
      expect(sheet.kind).toBe('form');
      if (sheet.kind !== 'form') return;
      expect(sheet.drafting).toBe(true);
      expect(sheet.form.base).toBe('main');

      drafts[0]!.resolve({ title: 'Drafted', body: 'Body' });
      await flush();
      sheet = flow.sheet();
      if (sheet.kind !== 'form') throw new Error('expected form');
      expect(sheet.drafting).toBe(false);
      expect(sheet.form.title).toBe('Drafted');

      flow.updateForm({ title: 'Edited', reviewers: ['rk'], draft: true });
      flow.submit();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain('draft pull request');
      expect(sent[0]).toContain('- Title: Edited');
      expect(sent[0]).toContain('@rk');
      expect(flow.sheet().kind).toBe('creating');
      dispose();
    });
  });

  it('edit: refuses an empty title and surfaces draft failures', async () => {
    await createRoot(async (dispose) => {
      const { flow, drafts } = setup();
      flow.start('edit');
      drafts[0]!.reject(new Error('model down'));
      await flush();
      let sheet = flow.sheet();
      if (sheet.kind !== 'form') throw new Error('expected form');
      expect(sheet.error).toBe('model down');
      flow.submit();
      sheet = flow.sheet();
      if (sheet.kind !== 'form') throw new Error('expected form');
      expect(sheet.error).toBe('Give the pull request a title.');
      dispose();
    });
  });

  it('quick: a failed draft falls back to the form', async () => {
    await createRoot(async (dispose) => {
      const { flow, drafts, sent } = setup();
      flow.start('quick');
      drafts[0]!.reject(new Error('nope'));
      await flush();
      const sheet = flow.sheet();
      expect(sheet.kind).toBe('form');
      if (sheet.kind === 'form') expect(sheet.error).toBe('nope');
      expect(sent).toHaveLength(0);
      dispose();
    });
  });

  it('regenerate rewrites the title and body in place', async () => {
    await createRoot(async (dispose) => {
      const { flow, drafts } = setup();
      flow.start('edit');
      drafts[0]!.resolve({ title: 'A', body: 'a' });
      await flush();
      flow.updateForm({ reviewers: ['x'] });
      flow.regenerate();
      drafts[1]!.resolve({ title: 'B', body: 'b' });
      await flush();
      const sheet = flow.sheet();
      if (sheet.kind !== 'form') throw new Error('expected form');
      expect(sheet.form).toMatchObject({
        title: 'B',
        body: 'b',
        reviewers: ['x'],
      });
      dispose();
    });
  });

  it('github opens the compare page, and a linked PR is viewed instead of recreated', () => {
    createRoot((dispose) => {
      const { flow, opened, setPullRequestUrl, sent } = setup();
      flow.start('github');
      expect(opened[0]).toContain('/compare/main...agent%2Fx');

      setPullRequestUrl('https://github.com/macro-inc/macro/pull/9');
      flow.start('quick');
      expect(sent).toHaveLength(0);
      expect(flow.sheet()).toEqual({
        kind: 'opened',
        url: 'https://github.com/macro-inc/macro/pull/9',
        title: undefined,
      });
      flow.close();
      expect(flow.sheet()).toEqual({ kind: 'closed' });
      dispose();
    });
  });

  it('will not post while the agent cannot take a prompt', async () => {
    await createRoot(async (dispose) => {
      const { flow, drafts, sent, notified } = setup({ canSend: false });
      flow.start('quick');
      drafts[0]!.resolve({ title: 'T', body: 'B' });
      await flush();
      expect(sent).toHaveLength(0);
      expect(notified[0]).toMatch(/cannot take a prompt/);
      dispose();
    });
  });
});
