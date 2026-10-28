import type { EmailRecipient } from '@app/features/email-compose/core/email-recipient';
import { cn } from '@ui';
import { type Accessor, createSignal, type JSX } from 'solid-js';
import type { RecipientFieldId } from '../core/email-recipient';

export function RecipientDropRow(props: {
  field: RecipientFieldId;
  class?: string;
  children: JSX.Element;
  dragState: Accessor<{
    recipient: EmailRecipient;
    sourceField: RecipientFieldId;
  } | null>;
  onDrop: (
    targetField: RecipientFieldId,
    recipient: EmailRecipient,
    sourceField: RecipientFieldId
  ) => void;
}) {
  const [isDragOver, setIsDragOver] = createSignal(false);

  const handleDragOver = (e: DragEvent) => {
    const drag = props.dragState();
    if (!drag || drag.sourceField === props.field) return;
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
    const drag = props.dragState();
    if (!drag || drag.sourceField === props.field) return;
    props.onDrop(props.field, drag.recipient, drag.sourceField);
  };

  return (
    <div
      class={cn('flex flex-row items-start min-w-0', props.class)}
      classList={{ 'bg-accent/10': isDragOver() }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {props.children}
    </div>
  );
}
