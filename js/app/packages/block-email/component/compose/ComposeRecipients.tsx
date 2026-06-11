import type { EmailRecipient } from '@block-email/component/EmailContext';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { isMobile } from '@core/mobile/isMobile';
import { cn } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { FromInboxSelector } from '../FromInboxSelector';
import { type RecipientFieldId, useCompose } from './ComposeContext';

type DragState = {
  recipient: EmailRecipient;
  sourceField: RecipientFieldId;
};

function ComposeFieldRow(props: {
  label: string;
  children: JSX.Element;
  fieldId?: RecipientFieldId;
  dragState?: () => DragState | null;
  onRecipientDrop?: (
    recipient: EmailRecipient,
    sourceField: RecipientFieldId
  ) => void;
  onRowFocusIn?: () => void;
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
      class={cn(
        'flex gap-2 py-1 border-b border-edge-muted focus-within:border-accent',
        isMobile() ? 'items-start' : 'items-center'
      )}
      classList={{ 'border-accent bg-accent/10': isDragOver() }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onFocusIn={() => props.onRowFocusIn?.()}
    >
      <div
        class={cn(
          'text-sm shrink-0 text-ink-placeholder',
          isMobile() ? 'min-h-9 flex items-center' : 'w-14'
        )}
      >
        {props.label}
      </div>
      <div class="flex-1 min-w-0">{props.children}</div>
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

  const recipientSelector = (
    field: RecipientFieldId,
    inputRef?: (el: HTMLElement) => void,
    opts?: { focusOnMount?: boolean; includeSelf?: boolean }
  ) => (
    <RecipientSelector
      inputRef={inputRef}
      options={ctx.recipientOptions}
      selfEmail={ctx.fromAddress?.()}
      selectedOptions={ctx.recipients()[field]}
      setSelectedOptions={(next) => ctx.setRecipients(field, next)}
      placeholder={isMobile() ? '' : 'Macro users or email addresses'}
      focusOnMount={opts?.focusOnMount}
      hideBorder
      class={cn(
        'bg-transparent [&_input]:ml-0!',
        isMobile() && '[&_input]:min-w-16! [&_input]:min-h-9!'
      )}
      noPadding
      disabled={ctx.disabled()}
      includeSelf={opts?.includeSelf}
      onChipDragStart={(option, e) => handleChipDragStart(field, option, e)}
      onChipDragEnd={handleChipDragEnd}
    />
  );

  const fieldRow = (
    field: RecipientFieldId,
    label: string,
    children: JSX.Element,
    onRowFocusIn?: () => void
  ) => (
    <ComposeFieldRow
      label={label}
      fieldId={field}
      dragState={recipientDragState}
      onRecipientDrop={(recipient, sourceField) =>
        handleRecipientDrop(field, recipient, sourceField)
      }
      onRowFocusIn={onRowFocusIn}
    >
      {children}
    </ComposeFieldRow>
  );

  // Collapse the expanded Cc/Bcc/From rows back into the combined row when
  // the user moves on without entering any Cc/Bcc recipients (iOS Mail).
  const collapseIfEmpty = () => {
    if (ctx.recipients().cc.length === 0 && ctx.recipients().bcc.length === 0) {
      props.setShowCc(false);
      props.setShowBcc(false);
    }
  };

  const expand = () => {
    props.setShowCc(true);
    props.setShowBcc(true);
  };

  const toRow = (onRowFocusIn?: () => void) =>
    fieldRow(
      'to',
      isMobile() ? 'To:' : 'To',
      <>
        {recipientSelector('to', props.toRef, {
          focusOnMount: ctx.focusRecipientsOnMount,
          includeSelf: ctx.includeSelf,
        })}
        <Show when={ctx.validationError('no_recipient')}>
          {(err) => (
            <div class="text-failure-ink text-sm mt-1">{err().message}</div>
          )}
        </Show>
      </>,
      onRowFocusIn
    );

  const ccRow = () =>
    fieldRow(
      'cc',
      isMobile() ? 'Cc:' : 'Cc',
      recipientSelector('cc', props.ccRef)
    );
  const bccRow = () =>
    fieldRow(
      'bcc',
      isMobile() ? 'Bcc:' : 'Bcc',
      recipientSelector('bcc', props.bccRef)
    );

  return (
    <Show
      when={isMobile()}
      fallback={
        <div class="flex flex-col gap-2">
          {toRow()}
          <Show when={isCcVisible()}>{ccRow()}</Show>
          <Show when={isBccVisible()}>{bccRow()}</Show>
        </div>
      }
    >
      <div class="flex flex-col gap-2">
        {toRow(collapseIfEmpty)}
        <Show
          when={isCcVisible() || isBccVisible()}
          fallback={
            <button
              type="button"
              class="w-full flex items-center gap-2 py-1 border-b border-edge-muted text-left"
              onClick={expand}
            >
              <span class="text-sm shrink-0 text-ink-placeholder min-h-9 flex items-center">
                Cc/Bcc, From:
              </span>
              <span class="ph-no-capture text-sm text-ink-muted truncate min-h-9 flex items-center">
                {ctx.fromAddress?.()}
              </span>
            </button>
          }
        >
          {ccRow()}
          {bccRow()}
          <div class="flex items-center gap-2 py-1 border-b border-edge-muted">
            <div class="text-sm shrink-0 text-ink-placeholder">From:</div>
            <div class="flex-1 min-w-0 min-h-9 flex items-center">
              <FromInboxSelector
                links={ctx.fromInboxes?.() ?? []}
                activeLinkId={ctx.selectedFromLinkId?.()}
                onSelect={(id) => ctx.onSelectFromLink?.(id)}
              />
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
