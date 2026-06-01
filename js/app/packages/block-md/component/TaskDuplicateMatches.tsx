import { SidePanel } from '@app/component/side-panel';
import { useBlockId } from '@core/block';
import { DocumentMention } from '@core/component/LexicalMarkdown/component/decorator/DocumentMention';
import { toast } from '@core/component/Toast/Toast';
import CaretDownIcon from '@phosphor/caret-down.svg';
import WarningIcon from '@phosphor/warning.svg';
import {
  useDismissTaskDuplicatesMutation,
  useTaskDuplicatesQuery,
} from '@queries/storage/task-duplicates';
import type { TaskDuplicate } from '@service-storage/client';
import { Button, cn, Dropdown } from '@ui';
import { createMemo, createSignal, For, Show, Suspense } from 'solid-js';

export function TaskDuplicateMatchPill() {
  const matches = useTaskDuplicateMatches();
  const [open, setOpen] = createSignal(false);

  return (
    <Suspense>
      <Show when={matches.count() > 0}>
        <Dropdown open={open()} onOpenChange={setOpen} placement="bottom-start">
          <Dropdown.Trigger
            depth={2}
            class={cn(
              'h-auto min-w-0 gap-1.5 rounded-full border-failure/40 px-2 py-1 leading-tight',
              'bg-failure/10 text-failure-ink shadow-none',
              'hover:bg-failure/15 focus-visible:bg-failure/15 focus-visible:ring-failure/60',
              open() && 'bg-failure/15'
            )}
            title="Possible duplicate tasks"
          >
            <WarningIcon class="size-3 shrink-0" />
            <span class="truncate">Duplicate Detected</span>
            <CaretDownIcon class="size-3 shrink-0 text-current/70" />
          </Dropdown.Trigger>
          <Dropdown.Content class="max-w-[calc(100vw-24px)]">
            <TaskDuplicateMatchPopover matches={matches} />
          </Dropdown.Content>
        </Dropdown>
      </Show>
    </Suspense>
  );
}

export function TaskDuplicateMatchesSidePanelSection() {
  const matches = useTaskDuplicateMatches();

  return (
    <Suspense>
      <Show when={matches.count() > 0}>
        <SidePanel.Section
          id="duplicates"
          title="Duplicate Tasks"
          defaultOpen
          order={60}
        >
          <TaskDuplicateMatchesSidePanel matches={matches} />
        </SidePanel.Section>
      </Show>
    </Suspense>
  );
}

type TaskDuplicateMatchesState = ReturnType<typeof useTaskDuplicateMatches>;

function useTaskDuplicateMatches() {
  const blockId = useBlockId();
  const matchesQuery = useTaskDuplicatesQuery(() => blockId);
  const dismissMutation = useDismissTaskDuplicatesMutation(() => blockId);

  const matches = createMemo(() => matchesQuery.data ?? []);
  const count = () => matches().length;

  const dismiss = async (matchesToDismiss: TaskDuplicate[]) => {
    if (matchesToDismiss.length === 0) return;
    const plural = matchesToDismiss.length > 1;

    try {
      await dismissMutation.mutateAsync({
        matchIds: matchesToDismiss.map((match) => match.id),
        otherDocumentIds: matchesToDismiss.map((match) => match.taskId),
      });
      toast.success(plural ? 'Duplicates dismissed.' : 'Duplicate dismissed.');
    } catch {
      toast.failure(
        plural
          ? 'Could not dismiss duplicates.'
          : 'Could not dismiss duplicate.'
      );
    }
  };

  return {
    count,
    dismiss,
    matches,
  };
}

function TaskDuplicateMatchPopover(props: {
  matches: TaskDuplicateMatchesState;
}) {
  return (
    <>
      <Dropdown.Group class="max-h-[320px] overflow-auto">
        <div class="flex w-max max-w-[calc(100vw-48px)] flex-col gap-0.5">
          <For each={props.matches.matches()}>
            {(match) => (
              <TaskDuplicateRow
                match={match}
                onDismiss={() => props.matches.dismiss([match])}
              />
            )}
          </For>
        </div>
      </Dropdown.Group>
      <Dropdown.Group>
        <DismissAllButton
          onDismissAll={() => props.matches.dismiss(props.matches.matches())}
        />
      </Dropdown.Group>
    </>
  );
}

function TaskDuplicateMatchesSidePanel(props: {
  matches: TaskDuplicateMatchesState;
}) {
  return (
    <div class="flex flex-col gap-1">
      <For each={props.matches.matches()}>
        {(match) => (
          <TaskDuplicateRow
            match={match}
            onDismiss={() => props.matches.dismiss([match])}
          />
        )}
      </For>
      <DismissAllButton
        onDismissAll={() => props.matches.dismiss(props.matches.matches())}
      />
    </div>
  );
}

function TaskDuplicateMention(props: { match: TaskDuplicate }) {
  return (
    <span class="min-w-0 flex-1 truncate text-xs">
      <DocumentMention
        key={props.match.id}
        documentId={props.match.taskId}
        documentName={props.match.taskName || 'Untitled task'}
        blockName="task"
        theme={{}}
      />
    </span>
  );
}

function DismissDuplicateButton(props: { onDismiss: () => void }) {
  return (
    <Button
      depth={2}
      variant="base"
      size="sm"
      class="h-6 shrink-0 px-2 text-xs"
      onClick={props.onDismiss}
    >
      Dismiss
    </Button>
  );
}

function DismissAllButton(props: { onDismissAll: () => void }) {
  return (
    <Button
      depth={2}
      variant="base"
      size="sm"
      class="mt-1 w-fit text-xs"
      onClick={props.onDismissAll}
    >
      Dismiss all
    </Button>
  );
}

function TaskDuplicateRow(props: {
  match: TaskDuplicate;
  onDismiss: () => void;
}) {
  return (
    <div class={cn('rounded-lg px-2 py-1.5', 'hover:bg-surface-hover')}>
      <div class="flex min-w-0 items-center gap-1.5">
        <TaskDuplicateMention match={props.match} />
        <DismissDuplicateButton onDismiss={props.onDismiss} />
      </div>
    </div>
  );
}
