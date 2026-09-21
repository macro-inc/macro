import { getIsSpecialProject } from '@block-project/isSpecial';
import { useBlockId } from '@core/block';
import {
  ShareBlockModal,
  ShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_PROJECT_SHARING } from '@core/constant/featureFlags';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { projectBlockDataSignal } from '../signal/projectBlockData';

export function ModalsProvider(props: ParentProps) {
  const id = useBlockId();
  const isSpecialProject = getIsSpecialProject(id);
  const name = () => projectBlockDataSignal()?.projectMetadata.name;
  const owner = () => projectBlockDataSignal()?.projectMetadata.userId;
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
      <Show when={ENABLE_PROJECT_SHARING && !isSpecialProject}>
        <ShareBlockModal name={name()} owner={owner()} />
      </Show>
    </ShareDialogContext.Provider>
  );
}
