import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { createSignal, type ParentProps } from 'solid-js';

export function SpreadsheetModalsProvider(
  props: ParentProps<{ share?: string }>
) {
  const name = useBlockDocumentName();
  const [shareOpen, setShareOpen] = createSignal(props.share === 'true');

  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      {props.children}
      <ShareBlockModal name={name()} />
    </ShareDialogContext.Provider>
  );
}
