import type { EmailRecipient } from '@block-email/component/EmailContext';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { createSignal, Show } from 'solid-js';
import { type RecipientFieldId, useCompose } from './ComposeContext';

type DragState = {
  recipient: EmailRecipient;
  sourceField: RecipientFieldId;
};

function ComposeFieldRow(props: {
  label: string;
  children: import('solid-js').JSX.Element;
  fieldId?: RecipientFieldId;
  dragState?: () => DragState | null;
  onRecipientDrop?: (
    recipient: EmailRecipient,
    sourceField: RecipientFieldId
  ) => void;
}) {
  const [isDragOver, setIsDragOver] = createSignal(false);

  const handleDragOver = (e: DragEvent) => {
    const drag = props.dragState?.();
    if (!drag || !props.fieldId || drag.sourceField === props.fieldId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const drag = props.dragState?.();
    if (!drag || !props.fieldId || drag.sourceField === props.fieldId) return;
    props.onRecipientDrop?.(drag.recipient, drag.sourceField);
  };

  return (
    <div
      class="flex items-center gap-2 border-b border-edge-muted focus-within:border-accent"
      classList={{ 'border-accent bg-accent/10': isDragOver() }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="text-sm w-7 shrink-0 text-ink-placeholder/70">
        {props.label}
      </div>
      <div class="flex-1">{props.children}</div>
    </div>
  );
}

export function ComposeRecipients(props: {
  toRef?: (el: HTMLElement) => void;
  ccRef?: (el: HTMLElement) => void;
  bccRef?: (el: HTMLElement) => void;
  showCc: () => boolean;
  setShowCc: (v: boolean) => void;
  showBcc: () => boolean;
  setShowBcc: (v: boolean) => void;
}) {
  const ctx = useCompose();

  const isCcVisible = () => props.showCc() || ctx.recipients().cc.length > 0;
  const isBccVisible = () => props.showBcc() || ctx.recipients().bcc.length > 0;

  const [recipientDragState, setRecipientDragState] =
    createSignal<DragState | null>(null);

  const handleChipDragStart = (
    field: RecipientFieldId,
    recipient: EmailRecipient,
    e: DragEvent
  ) => {
    if (!e.dataTransfer) return;
    setRecipientDragState({ recipient, sourceField: field });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  };

  const handleChipDragEnd = () => {
    setRecipientDragState(null);
  };

  const handleRecipientDrop = (
    targetField: RecipientFieldId,
    recipient: EmailRecipient,
    sourceField: RecipientFieldId
  ) => {
    const sourceList = ctx.recipients()[sourceField];
    ctx.setRecipients(
      sourceField,
      sourceList.filter((r) => r.id !== recipient.id)
    );
    const targetList = ctx.recipients()[targetField];
    if (!targetList.some((r) => r.id === recipient.id)) {
      ctx.setRecipients(targetField, [...targetList, recipient]);
    }
    if (targetField === 'cc') props.setShowCc(true);
    if (targetField === 'bcc') props.setShowBcc(true);
  };

  return (
    <div class="flex flex-col gap-2">
      <ComposeFieldRow
        label="To"
        fieldId="to"
        dragState={recipientDragState}
        onRecipientDrop={(recipient, sourceField) =>
          handleRecipientDrop('to', recipient, sourceField)
        }
      >
        <RecipientSelector
          inputRef={props.toRef}
          options={ctx.recipientOptions}
          selectedOptions={ctx.recipients().to}
          setSelectedOptions={(next) => ctx.setRecipients('to', next)}
          placeholder="Macro users or email addresses"
          focusOnMount={ctx.focusRecipientsOnMount}
          hideBorder
          noBrackets
          disabled={ctx.disabled()}
          onChipDragStart={(option, e) => handleChipDragStart('to', option, e)}
          onChipDragEnd={handleChipDragEnd}
        />
        <Show when={ctx.validationError('no_recipient')}>
          {(err) => (
            <div class="text-failure-ink text-sm mt-1">{err().message}</div>
          )}
        </Show>
      </ComposeFieldRow>

      <Show when={isCcVisible()}>
        <ComposeFieldRow
          label="Cc"
          fieldId="cc"
          dragState={recipientDragState}
          onRecipientDrop={(recipient, sourceField) =>
            handleRecipientDrop('cc', recipient, sourceField)
          }
        >
          <RecipientSelector
            inputRef={props.ccRef}
            options={ctx.recipientOptions}
            selectedOptions={ctx.recipients().cc}
            setSelectedOptions={(next) => ctx.setRecipients('cc', next)}
            placeholder="Macro users or email addresses"
            hideBorder
            noBrackets
            disabled={ctx.disabled()}
            onChipDragStart={(option, e) =>
              handleChipDragStart('cc', option, e)
            }
            onChipDragEnd={handleChipDragEnd}
          />
        </ComposeFieldRow>
      </Show>

      <Show when={isBccVisible()}>
        <ComposeFieldRow
          label="Bcc"
          fieldId="bcc"
          dragState={recipientDragState}
          onRecipientDrop={(recipient, sourceField) =>
            handleRecipientDrop('bcc', recipient, sourceField)
          }
        >
          <RecipientSelector
            inputRef={props.bccRef}
            options={ctx.recipientOptions}
            selectedOptions={ctx.recipients().bcc}
            setSelectedOptions={(next) => ctx.setRecipients('bcc', next)}
            placeholder="Macro users or email addresses"
            hideBorder
            noBrackets
            disabled={ctx.disabled()}
            onChipDragStart={(option, e) =>
              handleChipDragStart('bcc', option, e)
            }
            onChipDragEnd={handleChipDragEnd}
          />
        </ComposeFieldRow>
      </Show>
    </div>
  );
}
