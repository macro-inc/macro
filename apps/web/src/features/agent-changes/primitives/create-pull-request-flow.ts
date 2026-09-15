/**
 * The four ways out of the same drafted title and description, and the
 * sheet that shows them.
 *
 *   quick  — draft, then ask the agent to open the pull request
 *   draft  — the same, opened as a draft
 *   edit   — the sheet, prefilled, so the reviewer adjusts it first
 *   github — GitHub's own compare form for the branch
 *
 * The agent opens the pull request and registers its URL with Macro; the
 * session's `pullRequestUrl` landing is what turns "creating" into
 * "opened".
 */

import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  ChangesHost,
  ChangesSource,
} from '../context/agent-changes-context';
import { type Changeset, compareUrl } from '../core/changeset';
import {
  buildPullRequestPrompt,
  initialPullRequestForm,
  type PullRequestAction,
  type PullRequestForm,
  type PullRequestSheet,
} from '../core/pull-request';

export type { PullRequestSheet } from '../core/pull-request';

export type PullRequestController = {
  sheet: Accessor<PullRequestSheet>;
  /** The session's pull request, once one is linked. */
  linkedUrl: Accessor<string | undefined>;
  /** GitHub's compare page for the changeset, when it can be built. */
  compareUrl: Accessor<string | undefined>;
  /** A quick or draft creation is in flight, so its buttons dim. */
  busy: Accessor<boolean>;
  start: (action: PullRequestAction) => void;
  updateForm: (patch: Partial<PullRequestForm>) => void;
  regenerate: () => void;
  submit: () => void;
  /** Show the sheet for an already-linked pull request. */
  view: () => void;
  close: () => void;
};

export function createPullRequestFlow(options: {
  source: Pick<ChangesSource, 'draftPullRequest'>;
  host: Pick<
    ChangesHost,
    'sendToAgent' | 'canSend' | 'pullRequestUrl' | 'openExternal' | 'notify'
  >;
  changeset: Accessor<Changeset | undefined>;
  /** Anything that needs the pane on screen goes through this first. */
  ensureVisible: () => void;
}): PullRequestController {
  const { source, host } = options;
  const [stored, setSheet] = createSignal<PullRequestSheet>({ kind: 'closed' });

  // "Creating" resolves the moment the session links a new pull request.
  const sheet = createMemo((): PullRequestSheet => {
    const current = stored();
    if (current.kind !== 'creating') return current;
    const url = host.pullRequestUrl();
    if (url && url !== current.previousUrl) {
      return { kind: 'opened', url, title: current.form.title };
    }
    return current;
  });

  const openedTitle = () => {
    const current = stored();
    return current.kind === 'creating' || current.kind === 'form'
      ? current.form.title
      : undefined;
  };

  const post = (form: PullRequestForm, changeset: Changeset) => {
    if (!host.canSend()) {
      host.notify('The agent cannot take a prompt right now.', 'failure');
      return;
    }
    host.sendToAgent(buildPullRequestPrompt(form, changeset));
    setSheet({ kind: 'creating', form, previousUrl: host.pullRequestUrl() });
  };

  const draft = async (asDraft: boolean, thenEdit: boolean) => {
    const changeset = options.changeset();
    if (!changeset) return;
    setSheet(
      thenEdit
        ? {
            kind: 'form',
            form: initialPullRequestForm({ title: '', body: '' }, changeset, {
              draft: asDraft,
            }),
            drafting: true,
          }
        : { kind: 'drafting', draft: asDraft }
    );
    try {
      const generated = await source.draftPullRequest();
      const form = initialPullRequestForm(generated, changeset, {
        draft: asDraft,
      });
      // The reviewer may have closed the sheet while the draft was written.
      const current = stored();
      if (current.kind === 'closed' || current.kind === 'opened') return;
      if (thenEdit) setSheet({ kind: 'form', form, drafting: false });
      else post(form, changeset);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'The description could not be drafted.';
      const current = stored();
      if (current.kind === 'drafting') {
        // Fall back to the sheet so the reviewer can write it by hand.
        setSheet({
          kind: 'form',
          form: initialPullRequestForm({ title: '', body: '' }, changeset, {
            draft: asDraft,
          }),
          drafting: false,
          error: message,
        });
      } else if (current.kind === 'form') {
        setSheet({ ...current, drafting: false, error: message });
      }
    }
  };

  const regenerate = async () => {
    const current = stored();
    if (current.kind !== 'form' || current.drafting) return;
    setSheet({ ...current, drafting: true, error: undefined });
    try {
      const generated = await source.draftPullRequest();
      const latest = stored();
      if (latest.kind !== 'form') return;
      setSheet({
        ...latest,
        form: { ...latest.form, title: generated.title, body: generated.body },
        drafting: false,
      });
    } catch (error) {
      const latest = stored();
      if (latest.kind !== 'form') return;
      setSheet({
        ...latest,
        drafting: false,
        error:
          error instanceof Error && error.message
            ? error.message
            : 'The description could not be drafted.',
      });
    }
  };

  const view = () => {
    const url = host.pullRequestUrl();
    if (!url) return;
    options.ensureVisible();
    setSheet({ kind: 'opened', url, title: openedTitle() });
  };

  return {
    sheet,
    linkedUrl: host.pullRequestUrl,
    compareUrl: () => {
      const changeset = options.changeset();
      return changeset ? compareUrl(changeset) : undefined;
    },
    busy: () => {
      const current = sheet();
      return current.kind === 'drafting' || current.kind === 'creating';
    },
    start: (action) => {
      if (host.pullRequestUrl()) {
        view();
        return;
      }
      options.ensureVisible();
      switch (action) {
        case 'quick':
          void draft(false, false);
          return;
        case 'draft':
          void draft(true, false);
          return;
        case 'edit':
          void draft(false, true);
          return;
        case 'github': {
          const changeset = options.changeset();
          const url = changeset ? compareUrl(changeset) : undefined;
          if (!url) {
            host.notify(
              'The branch is not on GitHub yet, so there is nothing to compare.',
              'failure'
            );
            return;
          }
          host.openExternal(url);
          return;
        }
      }
    },
    updateForm: (patch) => {
      const current = stored();
      if (current.kind !== 'form') return;
      setSheet({ ...current, form: { ...current.form, ...patch } });
    },
    regenerate: () => void regenerate(),
    submit: () => {
      const current = stored();
      const changeset = options.changeset();
      if (current.kind !== 'form' || current.drafting || !changeset) return;
      if (current.form.title.trim() === '') {
        setSheet({ ...current, error: 'Give the pull request a title.' });
        return;
      }
      post(current.form, changeset);
    },
    view,
    close: () => setSheet({ kind: 'closed' }),
  };
}
