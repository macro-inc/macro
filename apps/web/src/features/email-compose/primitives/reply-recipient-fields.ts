import { makeEventListener } from '@solid-primitives/event-listener';
import { type Accessor, createSignal, onMount } from 'solid-js';
import type { EmailRecipient, RecipientFieldId } from '../core/email-recipient';
import type { EmailFormRecipients } from './email-form-state';

/** Recipient field interaction, independent of drafts, sending and app services. */
export function createReplyRecipientFields(options: {
  values: Accessor<EmailFormRecipients>;
  setValues: (field: RecipientFieldId, values: EmailRecipient[]) => void;
  onChange: () => void;
  container: Accessor<HTMLElement | undefined>;
  disabled: Accessor<boolean>;
}) {
  const [showExpandedRecipients, setShowExpandedRecipients] =
    createSignal<boolean>(false);
  const [toRef, setToRef] = createSignal<HTMLInputElement>();
  const [ccRef, setCcRef] = createSignal<HTMLInputElement>();
  const [bccRef, setBccRef] = createSignal<HTMLInputElement>();
  const [showCc, setShowCc] = createSignal<boolean>();
  const [showBcc, setShowBcc] = createSignal<boolean>();
  const [recipientDragState, setRecipientDragState] = createSignal<{
    recipient: EmailRecipient;
    sourceField: 'to' | 'cc' | 'bcc';
  } | null>(null);
  const handleChipDragStart = (
    field: 'to' | 'cc' | 'bcc',
    recipient: EmailRecipient,
    e: DragEvent
  ) => {
    if (options.disabled()) {
      e.preventDefault();
      return;
    }
    if (!e.dataTransfer) return;
    setRecipientDragState({ recipient, sourceField: field });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  };

  const handleChipDragEnd = () => {
    setRecipientDragState(null);
  };

  const handleRecipientDrop = (
    targetField: 'to' | 'cc' | 'bcc',
    recipient: EmailRecipient,
    sourceField: 'to' | 'cc' | 'bcc'
  ) => {
    if (options.disabled()) return;
    const sourceList = options.values()[sourceField];
    options.setValues(
      sourceField,
      sourceList.filter((r) => r.id !== recipient.id)
    );
    const targetList = options.values()[targetField];
    if (!targetList.some((r) => r.id === recipient.id)) {
      options.setValues(targetField, [...targetList, recipient]);
    }
    if (targetField === 'cc') setShowCc(true);
    if (targetField === 'bcc') setShowBcc(true);
    options.onChange();
  };

  // Keep expanded recipients open while composing; collapse only when leaving
  // the composer or selecting outside its recipient popover.
  const expandedPointerDownHandler = (e: PointerEvent) => {
    if (showExpandedRecipients()) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (
        !options.container()?.contains(target) &&
        !target.closest('div[data-popper-positioner]')
      ) {
        setShowExpandedRecipients(false);
        setShowCc(options.values().cc.length > 0);
        setShowBcc(options.values().bcc.length > 0);
      }
    }
  };

  onMount(() => {
    makeEventListener(document, 'pointerdown', expandedPointerDownHandler);
  });

  const mobileDrawerCcBccOpen = () =>
    !!showCc() ||
    !!showBcc() ||
    options.values().cc.length > 0 ||
    options.values().bcc.length > 0;
  const toggleMobileDrawerCcBcc = () => {
    const next = !mobileDrawerCcBccOpen();
    setShowCc(next);
    setShowBcc(next);
  };

  return {
    disabled: options.disabled,
    showExpandedRecipients,
    setShowExpandedRecipients,
    toRef,
    setToRef,
    ccRef,
    setCcRef,
    bccRef,
    setBccRef,
    showCc,
    setShowCc,
    showBcc,
    setShowBcc,
    recipientDragState,
    handleChipDragStart,
    handleChipDragEnd,
    handleRecipientDrop,
    mobileDrawerCcBccOpen,
    toggleMobileDrawerCcBcc,
    setRecipients(field: RecipientFieldId, values: EmailRecipient[]) {
      if (options.disabled()) return;
      options.setValues(field, values);
      options.onChange();
    },
  };
}
