import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { createSignal, type ParentProps } from 'solid-js';

export function ModalsProvider(props: ParentProps) {
  const fileName = useBlockDocumentName('Unknown Filename');
  const [shareOpen, setShareOpen] = createSignal(false);
  return (
    <ShareDialogContext.Provider
      value={{
        isOpen: shareOpen,
        open: () => setShareOpen(true),
        close: () => setShareOpen(false),
      }}
    >
      {props.children}
      <ShareBlockModal name={fileName()} />
    </ShareDialogContext.Provider>
  );
}
