import { PopupPositioner } from '@core/component/GeneralizedPopup/PopupPositioner';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { Toolbar } from '@ui';
import { Show } from 'solid-js';
import { FormatTools } from '../component/FormatTools';
import type {
  NativeBodyPopupComposition,
  NativeBodyPopupFrame,
} from '../component/format-host/native-body-popup';
import { NativeBodyToolbar } from '../component/format-host/native-body-toolbar';
import { createNativeLinkSlot } from '../component/format-host/native-link-slot';

// Source shows its selection actions independently of formatting authority.
function controls(frame: NativeBodyPopupFrame) {
  const { props } = frame;
  const slots =
    props.host.root() !== null &&
    (props.slots ?? []).some((slot) => slot.button && slot.available());
  return (
    props.host.interactable() ||
    frame.commentControls() ||
    frame.snippetLinkControls() ||
    slots
  );
}

/** Desktop body popup: Source MarkdownPopup's FormatTools toolbar. */
function DesktopBodyFormatPopup(props: { frame: NativeBodyPopupFrame }) {
  const frame = props.frame;
  const popup = frame.props;
  const linkSlot = createNativeLinkSlot(popup.popup);
  return (
    <Show when={controls(frame) && frame.shown() && frame.anchor()}>
      {(reference) => (
        <ScopedPortal scope="local">
          <PopupPositioner
            anchor={reference()}
            useBlockBoundary
            ref={frame.setMenu}
          >
            <NativeBodyToolbar
              slots={[...(popup.slots ?? []), linkSlot]}
              interactable={popup.host.interactable}
              formatTools={(requestLink) => (
                <>
                  <FormatTools
                    withinPopup
                    formattingHost={popup.host}
                    onRequestLink={requestLink}
                  />
                  {/* Source MarkdownPopup: FormatTools then a divider before later actions. */}
                  <Show
                    when={
                      frame.commentControls() || frame.snippetLinkControls()
                    }
                  >
                    <Toolbar.Divider />
                  </Show>
                </>
              )}
              trailing={() => (
                <>
                  <Show when={frame.commentControls()}>
                    {popup.commentAction?.render(() => frame.setVisible(false))}
                  </Show>
                  <Show when={frame.snippetLinkControls()}>
                    {popup.snippetLinkAction?.render()}
                  </Show>
                </>
              )}
              hide={() => frame.setVisible(false)}
              focusEditor={() => popup.host.focus()}
              onClosed={popup.onToolbarClosed}
            />
          </PopupPositioner>
        </ScopedPortal>
      )}
    </Show>
  );
}

export const desktopBodyFormatPopup: NativeBodyPopupComposition = {
  available: controls,
  Popup: DesktopBodyFormatPopup,
};
