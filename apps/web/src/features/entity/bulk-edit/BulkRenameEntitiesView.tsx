import ArrowRight from '@phosphor/arrow-right.svg';
import { ActionDialogShell, Button, Tabs, TextField, Tooltip } from '@ui';
import { createSignal, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { createBulkRenameDssEntityMutation } from '../queries/rename';
import type { EntityData } from '../types/entity';
import { EntityActionSelection } from './components/EntityActionSelection';
import { type RenameMode, renamedEntityName } from './core/rename';

export const BulkRenameEntitiesView = (props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}) => {
  const mutation = createBulkRenameDssEntityMutation();
  const multi = () => props.entities.length > 1;
  const [value, setValue] = createSignal(props.entities[0]?.name ?? '');
  const [find, setFind] = createSignal('');
  const [replacement, setReplacement] = createSignal('');
  const [mode, setMode] = createSignal<RenameMode>(
    multi() ? 'append' : 'total'
  );
  const updates = () =>
    props.entities.map((entity) => ({
      entity,
      newName: renamedEntityName(
        entity.name ?? '',
        mode(),
        value(),
        find(),
        replacement()
      ),
    }));
  const changes = () =>
    updates().filter(({ entity, newName }) => newName !== (entity.name ?? ''));
  const preview = () => updates()[0];
  const label = () =>
    !multi()
      ? 'Name'
      : match(mode())
          .with('append', () => 'Text to append')
          .with('prepend', () => 'Text to prepend')
          .with('replace', () => 'Find')
          .with('total', () => 'New name for all items')
          .exhaustive();
  const finishEditing = async () => {
    try {
      const results = await mutation.mutateAsync(updates());
      if (results.some((result) => !result.success)) {
        props.onError?.(new Error('Some entities could not be renamed'));
        return;
      }
      props.onFinish();
    } catch (error) {
      console.error('Failed to rename entities:', error);
      props.onError?.(error);
    }
  };
  return (
    <form
      class="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void finishEditing();
      }}
    >
      <ActionDialogShell.Body>
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>
            {multi() ? `Rename ${props.entities.length} items` : 'Rename item'}
          </ActionDialogShell.Title>
          <ActionDialogShell.Description>
            {multi()
              ? 'Choose how to update the selected names.'
              : 'Give this item a name that’s easy to find.'}
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>
        <EntityActionSelection entities={props.entities} />
        <Show when={multi()}>
          <Tabs
            aria-label="Rename mode"
            value={mode()}
            fullWidth
            onChange={(next) => {
              if (
                next === 'prepend' ||
                next === 'append' ||
                next === 'replace' ||
                next === 'total'
              )
                setMode(next);
            }}
            list={[
              { value: 'prepend', label: 'Prepend' },
              { value: 'append', label: 'Append' },
              { value: 'replace', label: 'Replace' },
              { value: 'total', label: 'Total' },
            ]}
          />
        </Show>
        <Show
          when={mode() === 'replace'}
          fallback={
            <TextField value={value()} onChange={setValue}>
              <TextField.Label>{label()}</TextField.Label>
              <TextField.Input
                placeholder="Enter text…"
                onFocus={(event) => event.currentTarget.select()}
              />
            </TextField>
          }
        >
          <div class="grid grid-cols-2 gap-3">
            <TextField value={find()} onChange={setFind}>
              <TextField.Label>Find</TextField.Label>
              <TextField.Input placeholder="Text to replace" />
            </TextField>
            <TextField value={replacement()} onChange={setReplacement}>
              <TextField.Label>Replace with</TextField.Label>
              <TextField.Input placeholder="New text" />
            </TextField>
          </div>
        </Show>
        <Show when={multi() && preview()}>
          {(_preview) => (
            <div>
              <div class="mb-2 flex justify-between gap-2 text-xs text-ink-muted">
                <span>Preview · first item</span>
                <span aria-live="polite">
                  {changes().length} of {props.entities.length} names change
                </span>
              </div>
              <div class="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-edge-muted bg-input/50 p-3 text-xs">
                <Tooltip
                  label={preview()?.entity.name ?? 'Untitled'}
                  class="min-w-0 max-w-full"
                >
                  <span class="truncate text-ink-muted">
                    {preview()?.entity.name ?? 'Untitled'}
                  </span>
                </Tooltip>
                <ArrowRight class="size-3 text-ink-muted" />
                <Tooltip
                  label={preview()?.newName || 'Empty name'}
                  class="min-w-0 max-w-full"
                >
                  <span class="truncate">
                    {preview()?.newName || 'Empty name'}
                  </span>
                </Tooltip>
              </div>
              <Show when={mode() === 'total'}>
                <p class="mt-2 text-xs text-ink-muted">
                  All selected items will have the same name.
                </p>
              </Show>
            </div>
          )}
        </Show>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="strong">
          {multi()
            ? `Rename ${props.entities.length} ${props.entities.length === 1 ? 'item' : 'items'}`
            : 'Save name'}
        </Button>
      </ActionDialogShell.Footer>
    </form>
  );
};
