import type {
  SplitHandle,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { triggerFocusInput } from '@core/directive/focusInput';

/** Open the new-conversation page, including when its split is already mounted. */
export function openAgentComposer(
  layout: Pick<SplitManager, 'openWithSplit'>,
  preferNewSplit = false,
  seed?: {
    /** Unsent composer text, such as an @mention of the entity being asked about. */
    draft?: string;
    /** Open in this split instead of placing a new one. */
    handle?: SplitHandle;
  }
) {
  const content = {
    type: 'component' as const,
    id: 'agents',
    preserveParams: true,
    params: {
      focusComposer: crypto.randomUUID(),
      ...(seed?.draft !== undefined ? { draft: seed.draft } : {}),
    },
  };
  const split = layout.openWithSplit(content, {
    referredFrom: 'launcher',
    preferNewSplit,
    // Replace the given split even when another Agents split is open, so that
    // split keeps its own draft.
    ...(seed?.handle ? { handle: seed.handle, allowDuplicate: true } : {}),
  }).split;
  if (!split) return;
  // Opening an existing split activates it without updating its params.
  // Publish a new request so an open roster returns to the composer as well.
  const current = split.content();
  if (
    current.type !== 'component' ||
    current.params?.focusComposer !== content.params.focusComposer
  ) {
    split.replace({ next: content, mergeHistory: true });
  }
  // Scope focus to this split and the new-chat input, never an existing session
  // or Home's shared composer. Wait for asynchronous route/query mounting.
  triggerFocusInput(
    () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-agent-new-composer]')
      )
        .find((element) => element.dataset.agentNewComposer === split.id)
        ?.querySelector<HTMLElement>('[contenteditable="true"]') ??
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-agents-workspace]')
      )
        .find((element) => element.dataset.agentsWorkspace === split.id)
        ?.querySelector<HTMLElement>('.newchat [contenteditable="true"]')
  );
}
