/**
 * The pane's one controller: layout, model, and review
 * built from the capability contract and handed to the views together.
 */

import type { Accessor } from 'solid-js';
import type { AgentChangesContext } from '../context/agent-changes-context';
import type { DiffStyle, PaneLayout } from '../core/layout';
import { formatNotesForAgent, sendableNotes } from '../core/review-notes';
import { type ChangesModel, createChangesModel } from './create-changes-model';
import {
  createPaneLayout,
  type PaneLayoutController,
} from './create-pane-layout';
import {
  createReviewState,
  type ReviewController,
} from './create-review-state';

export type { DiffStyle } from '../core/layout';

export type AgentChangesController = {
  context: AgentChangesContext;
  /** False when the host can never have changes; every control renders nothing. */
  available: Accessor<boolean>;
  layout: PaneLayoutController;
  model: ChangesModel;
  /** Authoritative PR totals shared by the session header and sidebar. */
  changeCounts: Accessor<{ additions: number; deletions: number } | undefined>;
  review: ReviewController;
  diffStyle: Accessor<DiffStyle>;
  setDiffStyle: (style: DiffStyle) => void;
  /** Post every queued note to the agent as one prompt. */
  sendQueuedNotes: () => void;
  /**
   * Take queued notes off the dock as the markdown a composer send should
   * carry, and mark them sent. Empty when there is nothing to take — so a
   * second send in the same tick cannot post the same notes again.
   */
  consumeSendableNotes: () => string;
  /** The handoff card was dismissed for the changeset on screen. */
  handoffDismissed: Accessor<boolean>;
  dismissHandoff: () => void;
  copyPath: (path: string) => void;
};

export function createAgentChanges(options: {
  context: AgentChangesContext;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Optional controlled pane layout, such as the URL state. */
  paneLayout?: [get: Accessor<PaneLayout>, set: (layout: PaneLayout) => void];
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
    sessionId: host.scopeKey,
    storage: options.storage,
    layout: options.paneLayout,
  });
  const model = createChangesModel({
    source,
    changesVisible: layout.changesVisible,
  });
  const review = createReviewState({
    sessionId: host.scopeKey,
    changeset: model.changeset,
    storage: options.storage,
  });
  const [diffStyle, setDiffStyle] = options.diffStyle;
  const [dismissed, setDismissed] = options.dismissed;

  const copyPath = async (path: string) => {
    let copied = false;
    try {
      copied = await host.copyText(path);
    } catch {
      // Hosts may report clipboard failures by rejecting or returning false.
    }
    host.notify(
      copied ? 'Path copied' : 'The path could not be copied',
      copied ? 'success' : 'failure'
    );
  };

  const consumeSendableNotes = () => {
    const queued = sendableNotes(review.notes());
    if (queued.length === 0) return '';
    const markdown = formatNotesForAgent(queued);
    review.markQueuedSent();
    return markdown;
  };

  return {
    context: options.context,
    available: () => host.canHaveChanges?.() ?? true,
    layout,
    model,
    changeCounts: () =>
      host.pullRequestChangeCounts
        ? host.pullRequestChangeCounts()
        : model.changeset(),
    review,
    diffStyle,
    setDiffStyle,
    sendQueuedNotes: () => {
      const agent = host.agent;
      if (!agent) return;
      if (sendableNotes(review.notes()).length === 0) return;
      if (!agent.canSend()) {
        host.notify('The agent cannot take a prompt right now.', 'failure');
        return;
      }
      const markdown = consumeSendableNotes();
      if (markdown) agent.send(markdown);
    },
    consumeSendableNotes,
    handoffDismissed: () => {
      const id = model.changeset()?.id;
      return id !== undefined && dismissed() === id;
    },
    dismissHandoff: () => setDismissed(model.changeset()?.id),
    copyPath: (path) => void copyPath(path),
  };
}
