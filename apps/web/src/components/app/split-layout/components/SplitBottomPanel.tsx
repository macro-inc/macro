import { children, createEffect, onCleanup, type ParentProps } from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';

export function SplitBottomPanel(
  props: ParentProps<{
    id: string;
    title?: string;
    onClose?: () => void;
  }>
) {
  const splitPanel = useSplitPanelOrThrow();
  const resolved = children(() => props.children);

  createEffect(() => {
    const unregister = splitPanel.registerBottomPanel({
      id: props.id,
      title: props.title,
      content: resolved,
      onClose: props.onClose,
    });
    onCleanup(unregister);
  });

  return null;
}
