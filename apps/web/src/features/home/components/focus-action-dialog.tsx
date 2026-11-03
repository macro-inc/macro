import { isMobile } from '@core/mobile/isMobile';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Input } from '@ui';
import { Show } from 'solid-js';
import { FOCUS_LABELS, type FocusAction } from '../core/focus-actions';
import { FocusActionIcon } from './focus-action-row';

export function FocusActionDialog(props: {
  action: FocusAction;
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onComplete: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      fullscreen={isMobile()}
    >
      <div class="flex max-h-[85dvh] flex-col p-6 mobile:h-full mobile:max-h-none mobile:pt-[max(24px,var(--safe-top,0px))] mobile:pb-[max(24px,var(--safe-bottom,0px))]">
        <div class="flex items-center justify-between gap-3">
          <span class="flex items-center gap-2 text-sm text-ink-muted">
            <FocusActionIcon type={props.action.type} />
            {FOCUS_LABELS[props.action.type]}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close preview"
            onClick={props.onClose}
          >
            <CloseIcon class="size-4" />
          </Button>
        </div>
        <Dialog.Title class="mt-5 text-xl font-medium">
          {props.action.title}
        </Dialog.Title>
        <Dialog.Description class="mt-1 text-sm text-ink-muted">
          {props.action.source} · Sample preview
        </Dialog.Description>
        <div class="mt-6 min-h-0 flex-1 overflow-y-auto">
          <div class="rounded-xl border border-edge-muted p-4 text-sm leading-relaxed text-ink-muted">
            <p class="mb-2 text-xs font-medium text-ink">
              {props.action.type === 'CREATE_ROUTINE'
                ? 'What this routine does'
                : 'Context'}
            </p>
            {props.action.context}
          </div>
          <Show when={props.action.type === 'CREATE_ROUTINE'}>
            <label class="mt-5 block text-sm font-medium">
              Schedule
              <Input
                class="mt-2"
                aria-label="Routine schedule"
                value="Every Monday at 9:00 AM"
              />
            </label>
          </Show>
          <Show when={props.action.type !== 'LINK'}>
            <label
              class="mt-5 block text-sm font-medium"
              for={`draft-${props.action.id}`}
            >
              {props.action.type === 'CREATE_ROUTINE'
                ? 'Instructions'
                : 'Your draft'}
            </label>
            <textarea
              id={`draft-${props.action.id}`}
              class="mt-2 min-h-44 w-full resize-y rounded-xl border border-edge-muted bg-transparent p-4 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-edge-muted"
              value={props.draft}
              placeholder="Write your reply…"
              onInput={(event) =>
                props.onDraftChange(event.currentTarget.value)
              }
            />
          </Show>
          <Show when={props.action.type === 'LINK'}>
            <div class="mt-5 space-y-4 text-sm leading-relaxed">
              <h3 class="font-medium">Project proposal</h3>
              <p class="text-ink-muted">
                Bring the next milestone into focus with a clear scope, a small
                set of deliverables, and one shared place for decisions.
              </p>
              <div>
                <h4 class="font-medium">Scope</h4>
                <p class="text-ink-muted">
                  Align on the core experience, review the first iteration, and
                  gather feedback before expanding.
                </p>
              </div>
              <div>
                <h4 class="font-medium">Next steps</h4>
                <p class="text-ink-muted">
                  Confirm the plan, nominate an owner for each deliverable, and
                  schedule the first review.
                </p>
              </div>
            </div>
          </Show>
        </div>
        <div class="mt-6 flex items-center justify-between gap-3 border-t border-edge-muted pt-4">
          <span class="text-xs text-ink-extra-muted">
            Preview only · Nothing is sent or scheduled
          </span>
          <Button
            variant="primary"
            size="md"
            disabled={props.action.type !== 'LINK' && !props.draft.trim()}
            onClick={props.onComplete}
          >
            {props.action.type === 'LINK' ? 'Mark reviewed' : 'Done'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
