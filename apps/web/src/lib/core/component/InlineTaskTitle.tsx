import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { focusNeighborTask, isPlainArrow, returnToDocument, type TaskEdge } from '@core/component/inlineTaskNavigation';
import { CONTINUE_INLINE_TASK_DRAFT_COMMAND } from '@core/component/LexicalMarkdown/plugins/inline-task-draft/inlineTaskDraftPlugin';
import type { LexicalEditor, NodeKey } from 'lexical';
import { createRenameDssEntityMutation } from '@entity';
import type { PreviewDocumentProperties } from '@queries/preview/types';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import { type Accessor, createEffect, createSignal, onCleanup, Show } from 'solid-js';

export function InlineTaskTitle(props: {
  taskId: string;
  name: string;
  previewProperties?: PreviewDocumentProperties;
  editor?: LexicalEditor;
  nodeKey?: NodeKey;
}) {
  return (
    <Show
      when={props.previewProperties}
      fallback={<RestInlineTaskTitle taskId={props.taskId} name={props.name} editor={props.editor} nodeKey={props.nodeKey} />}
    >
      {(metadata) => (
        <InlineTaskTitleValue
          taskId={props.taskId}
          name={props.name}
          canEdit={() => metadata().canEdit}
          editor={props.editor}
          nodeKey={props.nodeKey}
        />
      )}
    </Show>
  );
}

function RestInlineTaskTitle(props: { taskId: string; name: string; editor?: LexicalEditor; nodeKey?: NodeKey }) {
  const accessQuery = useDocumentAccessLevelQuery(() => props.taskId);
  return (
    <InlineTaskTitleValue
      taskId={props.taskId}
      name={props.name}
      editor={props.editor}
      nodeKey={props.nodeKey}
      canEdit={() =>
        accessQuery.isSuccess &&
        hasPermissions(getPermissions(accessQuery.data), Permissions.CAN_EDIT)
      }
    />
  );
}

function InlineTaskTitleValue(props: {
  taskId: string;
  name: string;
  canEdit: Accessor<boolean>;
  editor?: LexicalEditor;
  nodeKey?: NodeKey;
}) {
  const rename = createRenameDssEntityMutation();
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [savedName, setSavedName] = createSignal<string>();
  let input: HTMLInputElement | undefined;
  let saving = false;
  let entryEdge: TaskEdge | undefined;
  let titleElement: HTMLSpanElement | undefined;

  const name = () => savedName() ?? props.name;
  createEffect(() => {
    if (props.name === savedName()) setSavedName(undefined);
  });
  createEffect(() => {
    if (!editing()) return;
    const frame = requestAnimationFrame(() => {
      if (editing()) {
        input?.focus();
        if (entryEdge) {
          const offset = entryEdge === 'start' ? 0 : input?.value.length ?? 0;
          input?.setSelectionRange(offset, offset);
          entryEdge = undefined;
        } else {
          input?.select();
        }
      }
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const beginEditing = () => {
    if (!props.canEdit() || editing()) return;
    entryEdge = titleElement?.dataset.inlineTaskEdge as TaskEdge | undefined;
    if (titleElement) delete titleElement.dataset.inlineTaskEdge;
    setDraft(name());
    setEditing(true);
  };

  const cancel = () => {
    if (saving) return;
    setEditing(false);
  };
  const save = async () => {
    if (!editing() || saving) return;
    const newName = draft().trim();
    if (!newName || newName === name()) {
      setEditing(false);
      return;
    }
    saving = true;
    try {
      const result = await rename.mutateAsync({
        entity: {
          type: 'document',
          id: props.taskId,
          name: name(),
          fileType: 'md',
          subType: { type: 'task' },
        },
        newName,
      });
      if (result.success) {
        setSavedName(newName);
        setEditing(false);
      }
    } catch {
      // Keep the draft available without taking focus back after navigation.
    } finally {
      saving = false;
    }
  };

  return (
    <span
      ref={titleElement}
      data-document-mention="true"
      data-inline-task-title
      data-inline-task-editable={props.canEdit() ? true : undefined}
      data-lexical-interactive
      tabIndex={props.canEdit() && !editing() ? 0 : undefined}
      role={props.canEdit() && !editing() ? 'button' : undefined}
      aria-label={props.canEdit() && !editing() ? `Edit task title: ${name()}` : undefined}
      on:focus={beginEditing}
      on:keydown={(event) => {
        if (!props.canEdit()) return;
        event.stopPropagation();
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          beginEditing();
        }
      }}
      data-document-id={props.taskId}
      data-block-name="task"
      data-document-name={name()}
      classList={{ 'cursor-text': props.canEdit() }}
      on:pointerdown={(event) => {
        if (props.canEdit()) event.stopPropagation();
      }}
      on:mousedown={(event) => {
        if (!props.canEdit()) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      on:pointerup={(event) => {
        if (props.canEdit()) event.stopPropagation();
      }}
      on:mouseup={(event) => {
        if (props.canEdit()) event.stopPropagation();
      }}
      on:click={(event) => {
        if (!props.canEdit()) return;
        event.preventDefault();
        event.stopPropagation();
        beginEditing();
      }}
    >
      <Show when={editing()} fallback={name().replaceAll('\n', ' ').trim() || <span class="text-ink-placeholder">Task name…</span>}>
        <span class="relative inline-grid min-w-[2ch] align-baseline" classList={{ 'max-w-full': !!draft() }}>
          <span aria-hidden="true" class="invisible whitespace-pre">
            {draft() || 'Task name…'}
          </span>
          <input
            ref={input}
            type="text"
            aria-label="Task title"
            class="absolute inset-0 w-full min-w-0 m-0 border-0 bg-transparent p-0 text-inherit outline-none placeholder:text-ink-placeholder"
            style={{ font: 'inherit' }}
            value={draft()}
            placeholder="Task name…"
            on:input={(event) => setDraft(event.currentTarget.value)}
            on:pointerdown={(event) => event.stopPropagation()}
            on:mousedown={(event) => event.stopPropagation()}
            on:click={(event) => event.stopPropagation()}
            on:keypress={(event) => event.stopPropagation()}
            on:keydown={(event) => {
              event.stopPropagation();
              if (event.isComposing) return;
              if (isPlainArrow(event) && props.editor && props.nodeKey) {
                const direction = event.key === 'ArrowUp' ? 'previous' : event.key === 'ArrowDown' ? 'next' : undefined;
                if (direction) {
                  event.preventDefault();
                  if (!focusNeighborTask(props.editor, props.nodeKey, direction)) {
                    returnToDocument(
                      props.editor,
                      props.nodeKey,
                      direction === 'previous' ? 'start' : 'end',
                      direction
                    );
                  }
                  return;
                }
                const edge = event.key === 'ArrowLeft' ? 'start' : event.key === 'ArrowRight' ? 'end' : undefined;
                const position = event.currentTarget.selectionStart;
                if (edge && position === event.currentTarget.selectionEnd && position === (edge === 'start' ? 0 : event.currentTarget.value.length)) {
                  event.preventDefault();
                  returnToDocument(props.editor, props.nodeKey, edge);
                  return;
                }
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const input = event.currentTarget;
                if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
                    props.editor && props.nodeKey && input.selectionStart === input.selectionEnd &&
                    input.selectionEnd === input.value.length &&
                    props.editor.dispatchCommand(CONTINUE_INLINE_TASK_DRAFT_COMMAND, props.nodeKey)) {
                  // The existing blur handler saves while the following draft takes focus.
                  input.blur();
                  return;
                }
                void save();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }}
            on:keyup={(event) => event.stopPropagation()}
            on:blur={() => void save()}
          />
        </span>
      </Show>
    </span>
  );
}
