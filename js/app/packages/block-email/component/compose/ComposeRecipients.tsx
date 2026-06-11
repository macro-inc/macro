import type { EmailRecipient } from '@block-email/component/EmailContext';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { isMobile } from '@core/mobile/isMobile';
import { cn } from '@ui';
import { createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { FromInboxSelector } from '../FromInboxSelector';
import { type RecipientFieldId, useCompose } from './ComposeContext';

type DragState = {
  recipient: EmailRecipient;
  sourceField: RecipientFieldId;
};

type RowFocusHandlers = {
  onRowFocusIn?: () => void;
  onRowFocusOut?: (e: FocusEvent) => void;
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
  onRowFocusOut?: (e: FocusEvent) => void;
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
      onFocusOut={(e) => props.onRowFocusOut?.(e)}
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

function recipientName(recipient: EmailRecipient) {
  switch (recipient.kind) {
    case 'user':
    case 'contact':
      return recipient.data.name || recipient.data.email;
    case 'custom':
      return recipient.data.email;
  }
}

export function ComposeRecipients(props: {
  toRef?: (el: HTMLElement) => void;
  ccRef?: (el: HTMLElement) => void;
  bccRef?: (el: HTMLElement) => void;
  showCc: () => boolean;
  setShowCc: (v: boolean) => void;
  showBcc: () => boolean;
  setShowBcc: (v: boolean) => void;
  onToRowFocusIn?: () => void;
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

  // On mobile an unfocused row with recipients collapses to a "Name, Name &
  // N more…" summary; tapping it brings the chips and input back.
  const [activeField, setActiveField] = createSignal<RecipientFieldId | null>(
    null
  );
  const inputEls: Partial<Record<RecipientFieldId, HTMLElement>> = {};

  const showSummary = (field: RecipientFieldId) =>
    isMobile() && activeField() !== field && ctx.recipients()[field].length > 0;

  const summaryParts = (field: RecipientFieldId) => {
    const names = ctx.recipients()[field].map(recipientName).filter(Boolean);
    return {
      names: names.slice(0, 2).join(', '),
      extra: Math.max(0, names.length - 2),
    };
  };

  const activate = (field: RecipientFieldId) => {
    setActiveField(field);
    requestAnimationFrame(() => inputEls[field]?.focus());
  };

  // Collapsing is deferred so the transient blur of tapping a suggestion
  // (whose selection lands via a debounced onChange) doesn't fold the row
  // mid-entry — picking a recipient cancels the pending collapse and
  // refocuses the input for the next one.
  let collapseTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(collapseTimer));

  const rowFocusHandlers = (
    field: RecipientFieldId,
    extraFocusIn?: () => void
  ): RowFocusHandlers => ({
    onRowFocusIn: () => {
      clearTimeout(collapseTimer);
      setActiveField(field);
      extraFocusIn?.();
    },
    onRowFocusOut: (e) => {
      const row = e.currentTarget as HTMLElement;
      if (e.relatedTarget instanceof Node && row.contains(e.relatedTarget))
        return;
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(() => {
        setActiveField((active) => (active === field ? null : active));
      }, 250);
    },
  });

  const recipientSelector = (
    field: RecipientFieldId,
    inputRef?: (el: HTMLElement) => void,
    opts?: { focusOnMount?: boolean; includeSelf?: boolean }
  ) => (
    <RecipientSelector
      inputRef={(el) => {
        inputEls[field] = el;
        inputRef?.(el);
      }}
      options={ctx.recipientOptions}
      selfEmail={ctx.fromAddress?.()}
      selectedOptions={ctx.recipients()[field]}
      setSelectedOptions={(next) => {
        ctx.setRecipients(field, next);
        if (isMobile()) {
          clearTimeout(collapseTimer);
          activate(field);
        }
      }}
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

  const summarizable = (field: RecipientFieldId, selector: JSX.Element) => (
    <Show
      when={!showSummary(field)}
      fallback={
        <button
          type="button"
          class="ph-no-capture w-full min-h-9 flex items-center text-sm text-ink text-left"
          onClick={() => activate(field)}
        >
          <span class="truncate">{summaryParts(field).names}</span>
          <Show when={summaryParts(field).extra > 0}>
            <span class="shrink-0 whitespace-pre">
              {` & ${summaryParts(field).extra} more…`}
            </span>
          </Show>
        </button>
      }
    >
      {selector}
    </Show>
  );

  const fieldRow = (
    field: RecipientFieldId,
    label: string,
    children: JSX.Element,
    handlers?: RowFocusHandlers
  ) => (
    <ComposeFieldRow
      label={label}
      fieldId={field}
      dragState={recipientDragState}
      onRecipientDrop={(recipient, sourceField) =>
        handleRecipientDrop(field, recipient, sourceField)
      }
      onRowFocusIn={handlers?.onRowFocusIn}
      onRowFocusOut={handlers?.onRowFocusOut}
    >
      {children}
    </ComposeFieldRow>
  );

  const expand = () => {
    props.setShowCc(true);
    props.setShowBcc(true);
  };

  const fieldLabel = (text: string) => (isMobile() ? `${text}:` : text);

  const toRow = (handlers?: RowFocusHandlers) =>
    fieldRow(
      'to',
      fieldLabel('To'),
      <>
        {summarizable(
          'to',
          recipientSelector('to', props.toRef, {
            focusOnMount: ctx.focusRecipientsOnMount,
            includeSelf: ctx.includeSelf,
          })
        )}
        <Show when={ctx.validationError('no_recipient')}>
          {(err) => (
            <div class="text-failure-ink text-sm mt-1">{err().message}</div>
          )}
        </Show>
      </>,
      handlers
    );

  const ccRow = (handlers?: RowFocusHandlers) =>
    fieldRow(
      'cc',
      fieldLabel('Cc'),
      summarizable('cc', recipientSelector('cc', props.ccRef)),
      handlers
    );
  const bccRow = (handlers?: RowFocusHandlers) =>
    fieldRow(
      'bcc',
      fieldLabel('Bcc'),
      summarizable('bcc', recipientSelector('bcc', props.bccRef)),
      handlers
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
        {toRow(rowFocusHandlers('to', props.onToRowFocusIn))}
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
          {ccRow(rowFocusHandlers('cc'))}
          {bccRow(rowFocusHandlers('bcc'))}
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
