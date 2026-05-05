import { globalSplitManager } from '@app/signal/splitLayout';
import { usePaywallState } from '@core/constant/PaywallState';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { PanelDialog } from '@core/component/PanelDialog';
import Dialog from '@corvu/dialog';
import { onMount } from 'solid-js';
import { Panel } from '@ui';
import PaywallComponent from './PaywallComponent';

export function Paywall() {
  const {
    paywallOpen,
    hidePaywall: _hidePaywall,
    paywallKey,
  } = usePaywallState();
  let paywallContentEl!: HTMLDivElement;
  const split = globalSplitManager();

  const hidePaywall = () => {
    _hidePaywall();

    // TODO: correctly return focus back soup
    setTimeout(() => {
      setTimeout(() => {
        const activeId = split?.activeSplitId();
        const activeSplitElement = activeId
          ? (document.querySelector(
              `[data-split-id="${activeId}"]`
            ) as HTMLElement)
          : null;
        if (activeSplitElement) {
          activeSplitElement.focus();
          return;
        }

        // Fallback to the unified entity list
        const unifiedEntityList = document
          .querySelector('[data-unified-entity-list]')
          ?.closest('[tabindex="0"]') as HTMLElement;

        if (unifiedEntityList) {
          unifiedEntityList.focus();
        }
      });
    });
  };

  const [attachHotkeys, _moveToProjectHotkeyScopeId] = useHotkeyDOMScope(
    'paywall',
    true
  );
  onMount(() => {
    attachHotkeys(paywallContentEl);
    setTimeout(() => {
      setTimeout(() => {
        paywallContentEl.focus();
      });
    });
  });

  return (
    <Dialog open={paywallOpen()} modal={true} onEscapeKeyDown={hidePaywall}>
      <Dialog.Portal>
        <PanelDialog position="center">
          <Dialog.Content
            class="max-w-[calc(100vw-16px)] overflow-hidden portal-scope"
            style={{ width: '900px' }}
          >
            <Panel active depth={2}>
              <div
                class="*:max-h-[85vh] font-sans"
                ref={paywallContentEl}
                tabIndex={-1}
              >
                <div class="overflow-y-auto p-6 sm:p-8">
                  <PaywallComponent
                    cb={hidePaywall}
                    errorKey={paywallKey()}
                  />
                </div>
              </div>
            </Panel>
          </Dialog.Content>
        </PanelDialog>
      </Dialog.Portal>
    </Dialog>
  );
}
