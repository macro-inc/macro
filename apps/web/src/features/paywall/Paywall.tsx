import { globalSplitManager } from '@app/signal/splitLayout';
import { usePaywallState } from '@core/constant/PaywallState';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { onMount } from 'solid-js';
import { PaywallDialog } from './components/paywall-dialog';
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
    <PaywallDialog
      open={paywallOpen()}
      onClose={hidePaywall}
      contentRef={(element) => {
        paywallContentEl = element;
      }}
    >
      <PaywallComponent cb={hidePaywall} errorKey={paywallKey()} />
    </PaywallDialog>
  );
}
