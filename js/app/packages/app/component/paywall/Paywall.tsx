import { globalSplitManager } from '@app/signal/splitLayout';
import { usePaywallState } from '@core/constant/PaywallState';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import Dialog from '@corvu/dialog';
import { onMount } from 'solid-js';
import MacroJump from '../MacroJump';
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

  // const formSubmit = async (e: SubmitEvent) => {
  //   e.preventDefault();
  //   if (isLoading()) return;
  //   setIsLoading(true);
  //   try {
  //     if (!discountCode().trim()) {
  //       if (!checkoutSessionUrl()) {
  //         toast.failure('Failed to create checkout session');
  //         return;
  //       }
  //       window.location.href = checkoutSessionUrl() ?? '';
  //       return;
  //     }
  //     const session = await stripeServiceClient.createCheckoutSession(
  //       discountCode()
  //     );
  //     if (session) {
  //       window.location.href = session;
  //     }
  //   } catch (error) {
  //     console.error(error);
  //     toast.failure('Failed to apply discount');
  //   } finally {
  //     setDiscountCode('');
  //     setIsLoading(false);
  //   }
  // };

  return (
    <Dialog
      open={paywallOpen()}
      // closeOnOutsidePointerStrategy="pointerdown"
      // noOutsidePointerEvents={!paywallOpen()}
      // trapFocus={true}
      modal={true}
      onEscapeKeyDown={hidePaywall}
    >
      <Dialog.Portal>
        {/* Full screen overlay with onboarding styling */}

        <Dialog.Content>
          <div
            class="fixed top-0 left-0 w-full h-full bg-dialog font-sans z-[9999]"
            ref={paywallContentEl}
            tabIndex={-1}
          >
            {/* Subtle border decorations matching onboarding - closer on mobile */}
            <div class="w-px border-edge border-dashed border-r h-full top-0 left-4 sm:left-12 absolute"></div>
            <div class="w-px border-edge border-dashed border-r h-full top-0 right-4 sm:right-12 absolute"></div>
            <div class="w-full h-px border-edge border-dashed border-b bottom-4 sm:bottom-12 left-0 absolute"></div>
            <div class="w-full h-px border-edge border-dashed border-b top-4 sm:top-12 left-0 absolute"></div>

            {/* Content area with same padding as onboarding */}
            <div class="flex flex-col h-full">
              <div class="flex-1 overflow-y-auto px-8 sm:px-16 pb-8 pt-16 sm:pt-8">
                <div class="max-w-4xl mx-auto min-h-full flex items-center justify-center">
                  <div class="w-full py-4 sm:py-8">
                    <PaywallComponent
                      cb={hidePaywall}
                      errorKey={paywallKey()}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <MacroJump tabbableParent={() => paywallContentEl} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
