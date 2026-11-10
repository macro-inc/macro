import { t } from '@app/lib/i18n';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  Button,
  Dialog,
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
  Surface,
} from '@ui';
import { createSignal, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  entityKindLabel,
  StackEditorForm,
} from '../components/stack-editor-form';
import { useNotificationStacksContext } from '../context/notification-stacks-context';
import {
  NEW_STACK_DRAFT,
  rulesFromDraft,
  type Stack,
  type StackDraft,
  type StackEntityKind,
} from '../core/stack';
import { createStackEditor } from '../primitives/stack-editor';
import { traceStackWrite } from '../primitives/stack-telemetry';

type StackEditorDialogProps = ManagedDialogProps & {
  /** The stack being edited; a new one when left out. */
  stack?: { id: string; draft: StackDraft };
  /** Where a new stack starts, such as with one channel already chosen. */
  initial?: StackDraft;
  onSaved?: (stack?: Stack) => void;
};

const problemMessage = (problem: 'name' | 'capture') =>
  match(problem)
    .with('name', () => t('notificationStacks.problemName'))
    .with('capture', () => t('notificationStacks.problemCapture'))
    .exhaustive();

/**
 * Create or edit a stack. On a phone the dialog is a bottom sheet and each
 * picker opens as the full-height picker sheet over it; on desktop the picker
 * opens inside the dialog.
 */
function StackEditorDialog(props: StackEditorDialogProps) {
  const context = useNotificationStacksContext();
  const editor = createStackEditor(
    props.stack?.draft ?? props.initial ?? NEW_STACK_DRAFT
  );
  const [saving, setSaving] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  // A problem shows once the reader has tried to save, not while they type.
  const [attempted, setAttempted] = createSignal(false);
  const [picking, setPicking] = createSignal<StackEntityKind>();
  // A sheet's picks apply on Done; the desktop picker edits the draft live.
  const [sheetIds, setSheetIds] = createSignal<string[]>([]);

  const openPicker = (kind: StackEntityKind) => {
    setSheetIds(editor.entityIds(kind));
    setPicking(kind);
  };

  const save = () =>
    traceStackWrite('notification_stack.save', async (span) => {
      const draft = editor.draft();
      const rules = rulesFromDraft(draft);
      span.setAttr('stack.new', props.stack === undefined);
      span.setAttr('stack.sources', draft.sources.length);
      span.setAttr('stack.senders', draft.senders.length);
      span.setAttr('stack.kinds', draft.kinds.length);
      span.setAttr('stack.release_rules', rules.release.length);
      if (props.stack) {
        span.setAttr('stack.id', props.stack.id);
        await context.stacks.update(props.stack.id, {
          name: draft.name.trim(),
          ...rules,
        });
        props.onSaved?.();
      } else {
        const created = await context.stacks.create(draft.name.trim(), rules);
        span.setAttr('stack.id', created.id);
        props.onSaved?.(created);
      }
    });

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (saving() || editor.problem()) return;
    setFailed(false);
    setSaving(true);
    try {
      await save();
      props.onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!saving()) props.onOpenChange(open);
      }}
      class="w-[min(36rem,90vw)]"
      visibleScrim
    >
      <Surface
        depth={2}
        class="flex max-h-[80dvh] flex-col overflow-y-auto rounded-xl text-ink"
      >
        <form
          onSubmit={(event) =>
            fireAndForget(submit(event), 'notification-stacks')
          }
          aria-busy={saving()}
        >
          <div class="flex flex-col gap-4 px-5 py-4">
            <div class="flex flex-col gap-1">
              <Dialog.Title class="text-base font-semibold">
                {props.stack
                  ? t('notificationStacks.editStack')
                  : t('notificationStacks.newStack')}
              </Dialog.Title>
              <Dialog.Description class="text-sm leading-5 text-ink-muted">
                {t('notificationStacks.editorDescription')}
              </Dialog.Description>
            </div>
            <StackEditorForm
              draft={editor.draft()}
              disabled={saving()}
              EntityLabel={context.EntityLabel}
              onNameChange={editor.setName}
              onPick={openPicker}
              onAddNameText={editor.addNameText}
              onRemoveSource={editor.removeSource}
              onRemoveSender={editor.removeSender}
              onKindChange={editor.setKind}
              onReleaseMentionsChange={editor.setReleaseMentions}
              onReleaseRepliesChange={editor.setReleaseReplies}
              picker={
                <Show when={!isTouchDevice() && picking()} keyed>
                  {(kind) => (
                    <div class="flex flex-col gap-2 rounded-lg border border-edge-muted p-2">
                      <context.EntityPicker
                        kind={kind}
                        ids={editor.entityIds(kind)}
                        onChange={(ids) => editor.setEntityIds(kind, ids)}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        class="self-end"
                        onClick={() => setPicking(undefined)}
                      >
                        {t('notificationStacks.pickerDone')}
                      </Button>
                    </div>
                  )}
                </Show>
              }
            />
            <Show when={attempted() && editor.problem()}>
              {(problem) => (
                <p role="alert" class="text-sm text-failure">
                  {problemMessage(problem())}
                </p>
              )}
            </Show>
            <Show when={failed()}>
              <p role="alert" class="text-sm text-failure">
                {t('notificationStacks.saveFailed')}
              </p>
            </Show>
          </div>
          <div class="flex items-center justify-end gap-2 px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              disabled={saving()}
              onClick={() => props.onOpenChange(false)}
            >
              {t('notificationStacks.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={saving()}>
              {props.stack
                ? t('notificationStacks.save')
                : t('notificationStacks.create')}
            </Button>
          </div>
        </form>
      </Surface>
      <Show when={isTouchDevice()}>
        <PickerSheet.Root
          open={picking() !== undefined}
          onCancel={() => setPicking(undefined)}
        >
          <Show when={picking()} keyed>
            {(kind) => (
              <>
                <PickerSheet.Header
                  title={entityKindLabel(kind)}
                  onDone={() => {
                    editor.setEntityIds(kind, sheetIds());
                    setPicking(undefined);
                  }}
                />
                <PickerSheet.Body>
                  <context.EntityPicker
                    kind={kind}
                    ids={sheetIds()}
                    onChange={setSheetIds}
                    fill
                  />
                </PickerSheet.Body>
              </>
            )}
          </Show>
        </PickerSheet.Root>
      </Show>
    </Dialog>
  );
}

/**
 * Open the stack editor. Pass the owner of a subtree under a
 * `NotificationStacksProvider`: the dialog reads its stacks and pickers there.
 */
export function openStackEditor(
  props: Omit<StackEditorDialogProps, keyof ManagedDialogProps>,
  options: OpenDialogOptions
) {
  openDialog(StackEditorDialog, props, options);
}
