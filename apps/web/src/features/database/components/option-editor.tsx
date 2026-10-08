import { Popover } from '@kobalte/core/popover';
import DotsIcon from '@phosphor/dots-three.svg';
import TrashIcon from '@phosphor/trash.svg';
import { ColorSwatches } from '@property/tags/components/color-swatches';
import { Button } from '@ui/components/Button';
import type { ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { toast } from '../../../lib/core/component/Toast/Toast';
import type { OptionEditing } from '../context/option-editing';
import { inferDatabaseNumber } from '../core/column-inference';
import type { DatabaseOption, DatabaseViewColumn } from '../core/database-view';
import {
  type DatabaseOpFailure,
  databaseOpMessage,
} from '../core/write-failure';

/**
 * A "⋯" button opening one option's editor: its name, its colour, and its
 * removal, which empties the cells holding it.
 */
export function OptionEditor(props: {
  column: DatabaseViewColumn;
  option: DatabaseOption;
  editing: OptionEditing;
  class?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal(props.option.label);
  const [confirming, setConfirming] = createSignal(false);
  const [error, setError] = createSignal('');
  const settle = (change: ResultAsync<void, DatabaseOpFailure>) =>
    change.match(
      () => setError(''),
      (failure) => setError(databaseOpMessage(failure, 'this option'))
    );
  const rename = () => {
    const label = name().trim();
    if (!label || label === props.option.label) {
      setName(props.option.label);
      return;
    }
    if (
      props.column.options.some(
        (option) =>
          option.id !== props.option.id &&
          option.label.toLocaleLowerCase() === label.toLocaleLowerCase()
      )
    ) {
      setError('Another option already has this name.');
      return;
    }
    if (
      props.column.dataType === 'SELECT_NUMBER' &&
      inferDatabaseNumber(label) === undefined
    ) {
      setError('Enter a number.');
      return;
    }
    void settle(
      props.editing.update(props.column.id, props.option.id, { label })
    );
  };
  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        setName(props.option.label);
        setConfirming(false);
        setError('');
      }}
      placement="right-start"
      gutter={6}
    >
      <Popover.Trigger
        as={Button}
        variant="ghost"
        size="icon-xs"
        label={`Edit ${props.option.label}`}
        tooltipDisabled
        class={props.class}
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onClick={(event: MouseEvent) => event.stopPropagation()}
      >
        <DotsIcon class="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="z-action-menu flex w-56 flex-col gap-2.5 rounded-lg border border-edge bg-menu p-2.5 text-xs text-ink shadow-menu outline-none"
          onClick={(event: MouseEvent) => event.stopPropagation()}
          on:keydown={(event) => {
            // Natively, so the popover or menu around it never hears this Escape.
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }}
        >
          <input
            aria-label="Option name"
            maxlength={200}
            value={name()}
            class="h-7 w-full rounded-md border border-edge-muted bg-input px-2 text-xs outline-none focus:border-ink/50"
            onInput={(event) => {
              setName(event.currentTarget.value);
              setError('');
            }}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.isComposing || event.key !== 'Enter') return;
              event.preventDefault();
              rename();
            }}
          />
          <ColorSwatches
            size="sm"
            value={props.option.color}
            onChange={(color) =>
              void settle(
                props.editing.update(props.column.id, props.option.id, {
                  color: color.color,
                })
              )
            }
          />
          <Show when={props.column.sharedOutsideDatabase}>
            <p class="text-ink-muted">
              Changes everywhere this property is used.
            </p>
          </Show>
          <Show
            when={confirming()}
            fallback={
              <Button
                variant="ghost"
                size="xs"
                class="justify-start gap-1.5 text-failure-ink"
                onClick={() => setConfirming(true)}
              >
                <TrashIcon class="size-3.5" />
                Delete option
              </Button>
            }
          >
            <div
              role="alertdialog"
              aria-label={`Delete ${props.option.label}?`}
              class="flex flex-col gap-2 rounded-md border border-edge-muted p-2"
            >
              <p>Cells using “{props.option.label}” will be cleared.</p>
              <div class="flex gap-1.5">
                <Button
                  variant="danger"
                  size="xs"
                  onClick={() => {
                    setOpen(false);
                    // The editor has closed, so a refusal says so in a toast.
                    void props.editing
                      .remove(props.column.id, props.option.id)
                      .mapErr((failure) =>
                        toast.failure(databaseOpMessage(failure, 'this option'))
                      );
                  }}
                >
                  Delete
                </Button>
                <Button size="xs" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Show>
          <Show when={error()}>
            <p role="alert" class="text-failure-ink">
              {error()}
            </p>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
