import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { triggerFocusInput } from '@core/directive/focusInput';

/** Open the new-conversation page, including when its split is already mounted. */
export function openAgentComposer(
  layout: Pick<SplitManager, 'openWithSplit'>,
  preferNewSplit = false
) {
  const content = {
    type: 'component' as const,
    id: 'agents',
    preserveParams: true,
    params: { focusComposer: crypto.randomUUID() },
  };
  const split = layout.openWithSplit(content, {
    referredFrom: 'launcher',
    preferNewSplit,
  });
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
  triggerFocusInput(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-agents-workspace]')
    )
      .find((element) => element.dataset.agentsWorkspace === split.id)
      ?.querySelector<HTMLElement>('.newchat [contenteditable="true"]')
  );
}
