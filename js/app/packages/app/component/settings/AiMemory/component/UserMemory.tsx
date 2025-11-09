import { TextButton } from '@core/component/TextButton';
import clickOutside from '@core/directive/clickOutside';
import { formatDate } from '@core/util/date';
import CheckIcon from '@icon/regular/check.svg';
import XIcon from '@icon/regular/x.svg';
import type { UserInsightRecord } from '@service-insight/generated/schemas/userInsightRecord';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo, createSignal, Match, onMount, Switch } from 'solid-js';
import { deleteMemory, updateUserMemory } from '../signal';

//@ts-ignore
clickOutside && false;

export type UserMemoryProps = {
  memory: UserInsightRecord;
};

export function UserMemory(props: UserMemoryProps) {
  let ref: HTMLDivElement | undefined;
  const prettyDate = createMemo(() => formatDate(props.memory.updatedAt));
  const [isEditing, setIsEditing] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);

  const onSave = createCallback((text: string) => {
    updateUserMemory(props.memory.id as string, text);
    setIsEditing(false);
  });

  const onCancel = () => {
    setIsEditing(false);
  };

  return (
    <div
      class="text-sm py-1"
      ref={ref}
      use:clickOutside={() => {
        setIsDeleting(false);
        setIsEditing(false);
      }}
    >
      <Switch>
        <Match when={isEditing()}>
          <EditMemory
            onCancel={onCancel}
            onSave={onSave}
            text={props.memory.content}
          />
        </Match>
        <Match when={isDeleting()}>
          <div class="flex items-center justify-center align-center flex-col w-full h-full">
            Are you sure you want to delete this memory?
            <div class="flex flex-row gap-x-1">
              <TextButton
                onClick={() => setIsDeleting(false)}
                icon={XIcon}
                theme="clear"
                text="Cancel"
              />

              <TextButton
                onClick={createCallback(() =>
                  deleteMemory(props.memory.id as string)
                )}
                icon={CheckIcon}
                theme="red"
                text="Delete"
              />
            </div>
          </div>
        </Match>
        <Match when={!isEditing()}>
          <div class="flex flex-row justify-between gap-x-2 items-center divide-x divide-1 divide-black/10">
            <div class="line-clamp-5 flex-1 flex flex-row justify-between">
              {props.memory.content}
              <div class="text-xs text-ink-extra-muted pr-2 p-1">
                Created {prettyDate()}
              </div>
            </div>
            <div class="flex flex-col items-center">
              <div class="flex flex-row gap-x-1 h-full items-center">
                <div
                  class="text-failure text-xs hover:bg-hover hover-transition-bg py-1 px-2 rounded-sm"
                  onClick={(e) => {
                    e.preventDefault();
                    setIsDeleting(true);
                  }}
                >
                  Delete
                </div>
                <div
                  class="text-accent-ink text-xs hover:bg-hover hover-transition-bg py-1 px-2 rounded-sm"
                  onClick={(e) => {
                    e.preventDefault();
                    setIsEditing(true);
                  }}
                >
                  Edit
                </div>
              </div>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

type EditMemoryProps = {
  onSave: (text: string) => void;
  onCancel: () => void;
  text: string;
  class?: string;
};

function EditMemory(props: EditMemoryProps) {
  let editableRef: HTMLDivElement | undefined;

  function keyHandler(e: KeyboardEvent) {
    if (
      e.metaKey &&
      e.key === 'Enter' &&
      editableRef?.textContent &&
      editableRef.textContent.length > 0
    )
      props.onSave(editableRef.textContent);
    if (e.key === 'Escape') props.onCancel();
  }

  function focusEditable() {
    if (editableRef) {
      editableRef.focus();
      const selection = document.getSelection();
      selection?.removeAllRanges();
      const range = document.createRange();
      range.setStart(
        editableRef.childNodes[0],
        editableRef.textContent?.length ?? 0
      );
      selection?.addRange(range);
    }
  }

  onMount(focusEditable);

  return (
    <div
      class={`w-full flex text-sm justify-between items-center ${props.class ?? ''} rounded-md border-accent border-1 p-1`}
    >
      <div
        ref={editableRef}
        contenteditable="plaintext-only"
        onKeyDown={keyHandler}
      >
        {props.text}
      </div>
      <div class="justify-end gap-x-1 flex flex-row items-center">
        <TextButton
          onClick={props.onCancel}
          icon={XIcon}
          text="Cancel"
          theme="clear"
        />
        <TextButton
          onClick={() => {
            if (editableRef?.textContent) props.onSave(editableRef.textContent);
          }}
          icon={CheckIcon}
          text="Save"
          theme="accent"
        />
      </div>
    </div>
  );
}
