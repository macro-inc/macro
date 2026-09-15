/**
 * The pane's one controller: layout, model, review, and pull request flow
 * built from the capability contract and handed to the views together.
 */

import type { Accessor } from 'solid-js';
import type { AgentChangesContext } from '../context/agent-changes-context';
import { formatNotesForAgent } from '../core/review-notes';
import { type ChangesModel, createChangesModel } from './create-changes-model';
import {
  createPaneLayout,
  type PaneLayoutController,
} from './create-pane-layout';
import {
  createPullRequestFlow,
  type PullRequestController,
} from './create-pull-request-flow';
import {
  createReviewState,
  type ReviewController,
} from './create-review-state';

export type DiffStyle = 'unified' | 'split';

export type AgentChangesController = {
  context: AgentChangesContext;
  layout: PaneLayoutController;
  model: ChangesModel;
  review: ReviewController;
  pullRequest: PullRequestController;
  diffStyle: Accessor<DiffStyle>;
  setDiffStyle: (style: DiffStyle) => void;
  /** Post every queued note to the agent as one prompt. */
  sendQueuedNotes: () => void;
  /** The handoff card was dismissed for the changeset on screen. */
  handoffDismissed: Accessor<boolean>;
  dismissHandoff: () => void;
  copyPath: (path: string) => void;
};

export function createAgentChanges(options: {
  context: AgentChangesContext;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Read and write the reviewer's diff layout preference. */
  diffStyle: [get: Accessor<DiffStyle>, set: (style: DiffStyle) => void];
  /** Per-session "dismissed for changeset id" memory. */
  dismissed: [
    get: Accessor<string | undefined>,
    set: (changesetId: string | undefined) => void,
  ];
}): AgentChangesController {
  const { source, host } = options.context;
  const layout = createPaneLayout({
    sessionId: host.sessionId,
    storage: options.storage,
  });
  const model = createChangesModel({
    source,
    changesVisible: layout.changesVisible,
  });
  const review = createReviewState({
    sessionId: host.sessionId,
    changeset: model.changeset,
    storage: options.storage,
  });
  const pullRequest = createPullRequestFlow({
    source,
    host,
    changeset: model.changeset,
    ensureVisible: layout.open,
  });
  const [diffStyle, setDiffStyle] = options.diffStyle;
  const [dismissed, setDismissed] = options.dismissed;

  return {
    context: options.context,
    layout,
    model,
    review,
    pullRequest,
    diffStyle,
    setDiffStyle,
    sendQueuedNotes: () => {
      const queued = review.queued();
      if (queued.length === 0) return;
      if (!host.canSend()) {
        host.notify('The agent cannot take a prompt right now.', 'failure');
        return;
      }
      host.sendToAgent(formatNotesForAgent(queued));
      review.markQueuedSent();
    },
    handoffDismissed: () => {
      const id = model.changeset()?.id;
      return id !== undefined && dismissed() === id;
    },
    dismissHandoff: () => setDismissed(model.changeset()?.id),
    copyPath: (path) => {
      void (async () => {
        const copied = await host.copyText(path);
        host.notify(
          copied ? 'Path copied' : 'The path could not be copied',
          copied ? 'success' : 'failure'
        );
      })();
    },
  };
}
