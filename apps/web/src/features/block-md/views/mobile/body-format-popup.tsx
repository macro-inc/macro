import { GeneralizedPopup } from '@core/component/GeneralizedPopup/Popup';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { fireAndForget } from '@core/util/fireAndForget';
import { onCleanup, Show } from 'solid-js';
import type {
  NativeBodyPopupComposition,
  NativeBodyPopupFrame,
} from '../../component/format-host/native-body-popup';
import { TouchSelectionToolbar } from '../../component/TouchSelectionToolbar';

// Source's touch toolbar always carries Copy and Share, so any live root
// with touch actions shows it.
const available = (frame: NativeBodyPopupFrame) =>
  frame.props.touch !== undefined && frame.props.host.root() !== null;

/** Touch body popup: Source PopupToolbar's TouchSelectionToolbar in a
 *  GeneralizedPopup, in a global portal above the mobile chrome. */
function MobileBodyFormatPopup(props: { frame: NativeBodyPopupFrame }) {
  const frame = props.frame;
  const popup = frame.props;
  const hide = () => frame.setVisible(false);
  const slot = (id: 'ai' | 'task') =>
    (popup.slots ?? []).find(
      (candidate) =>
        candidate.id === id && candidate.select && candidate.available()
    );
  // Source's Task option only with the slot's exact label
  // (C-TOUCH-TASK-LABEL-01: never a guessed one).
  const taskOption = () => {
    const task = slot('task');
    const label = task?.touchLabel?.();
    return label === undefined
      ? undefined
      : { label, converting: task?.converting?.() ?? false };
  };
  return (
    <Show when={available(frame) && frame.shown() && popup.touch}>
      {(touchActions) => (
        <Show when={frame.anchor()}>
          {(reference) => {
            const touch = touchActions();
            // Source PopupToolbar onCleanup.
            onCleanup(() => popup.onToolbarClosed?.());
            return (
              <ScopedPortal scope="global">
                <GeneralizedPopup
                  class="z-action-menu"
                  anchor={{
                    ref: reference(),
                    blockId: touch.documentId(),
                    blockType: 'md',
                  }}
                  useBlockBoundary={true}
                  ref={frame.setMenu}
                >
                  <TouchSelectionToolbar
                    canEdit={popup.host.interactable()}
                    canComment={touch.canComment()}
                    // Source MarkdownPopup :849: text emptiness, not collapse.
                    hasSelection={popup.popup.selectionText() !== ''}
                    showCreateTaskOption={taskOption() !== undefined}
                    createTaskLabel={taskOption()?.label ?? ''}
                    isConverting={taskOption()?.converting ?? false}
                    showTableOption={touch.table.available()}
                    showEditWithAiOption={slot('ai') !== undefined}
                    showOpenCommentOption={touch.openComment.available()}
                    locationCopied={touch.share()?.copied() ?? false}
                    setPopupVisible={frame.setVisible}
                    onCreateTask={() => slot('task')?.select?.(hide)}
                    onConvertListToTable={() => {
                      if (touch.table.convert()) hide();
                    }}
                    onOpenComment={() => touch.openComment.open(hide)}
                    onShare={() => {
                      const link = touch.share();
                      if (link)
                        fireAndForget(link.copy(), 'native-snippet-link');
                    }}
                    onInsertComment={() => touch.insertComment(hide)}
                    onPaste={() =>
                      fireAndForget(touch.paste(hide), 'markdown-editor')
                    }
                    onEditWithAi={() => slot('ai')?.select?.(hide)}
                  />
                </GeneralizedPopup>
              </ScopedPortal>
            );
          }}
        </Show>
      )}
    </Show>
  );
}

export const mobileBodyFormatPopup: NativeBodyPopupComposition = {
  available,
  Popup: MobileBodyFormatPopup,
};
