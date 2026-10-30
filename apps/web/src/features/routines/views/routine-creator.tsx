import ClockIcon from '@icon/system/regular/clock.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, EntityComposer } from '@ui';
import type { Accessor, JSX } from 'solid-js';
import { RoutineStart } from '../components/routine-start';
import type { ScheduleDraft } from '../core/draft';
import {
  availableTemplates,
  newRoutineDraft,
  type RoutineTemplate,
} from '../core/routine-templates';

/**
 * New routine: describe it for AI to draft, pick a template, or start fresh.
 * It never edits a routine itself; each choice hands its first draft to the
 * new routine's page, which saves it.
 */
export function RoutineCreatorView(props: {
  defaultModel: string;
  /** Decisions are answered by the classifier behind trigger conditions. */
  decisionsEnabled: boolean;
  /** Drafts the routine from a description; absent where that is unavailable. */
  renderComposer?: (
    apply: (draft: ScheduleDraft, description: string) => void,
    current: Accessor<ScheduleDraft>,
    initialDescription: string | undefined
  ) => JSX.Element;
  onStart(draft: ScheduleDraft): void;
  onClose(): void;
}) {
  const context = () => ({
    decisions: props.decisionsEnabled,
    defaultModel: props.defaultModel,
  });
  const blank = () => newRoutineDraft(undefined, context());
  // A drafted routine is described by what was asked for.
  const drafted = (draft: ScheduleDraft, description: string) =>
    props.onStart(
      description.trim() ? { ...draft, description: description.trim() } : draft
    );
  const startFrom = (template: RoutineTemplate) =>
    props.onStart(newRoutineDraft(template, context()));
  return (
    <EntityComposer.Root class="w-full h-auto max-h-[80vh]">
      <EntityComposer.Header class="items-start">
        <ClockIcon class="ml-2 mt-1 size-4 shrink-0 text-ink-muted" />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5 px-1">
          <h2 class="text-base font-semibold tracking-[-0.01em] text-ink">
            New routine
          </h2>
          <p class="text-sm text-ink-muted">
            Automate work you repeat and keep things moving.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => props.onStart(blank())}
        >
          Start fresh
        </Button>
        <Button
          size="icon-md"
          variant="ghost"
          aria-label="Close routine composer"
          onClick={() => props.onClose()}
        >
          <XIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
      </EntityComposer.Header>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pt-2">
        <RoutineStart
          describe={props.renderComposer?.(drafted, blank, undefined)}
          templates={availableTemplates(props.decisionsEnabled)}
          onTemplate={startFrom}
        />
      </div>
    </EntityComposer.Root>
  );
}
