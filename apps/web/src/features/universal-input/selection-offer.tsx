import { floatWithSelection } from '@core/component/LexicalMarkdown/directive/floatWithSelection';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { lazyNamed } from '@core/util/lazyNamed';
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { TypeIcon } from './components/type-icon';
import { actionLabels } from './core/input';
import { createInferenceSource } from './inference';
import {
  createSelectionOffer,
  type OfferedSelection,
} from './primitives/selection-offer';

false && floatWithSelection;

const SelectionDraft = lazyNamed(
  () => import('./views/selection-draft'),
  'SelectionDraft'
);

/** The card holds its place on the text, which outlives the selection on it. */
type OpenDraft = OfferedSelection & { anchor: Range };

/**
 * What the card wants once its fields arrive. It opens near-empty, so without
 * this it would take whichever side fits an empty card and then grow past the
 * viewport.
 */
const CARD_HEIGHT = 520;

/**
 * Offers the shape Universal Input recognizes in selected text, on every
 * surface that opted in with `data-selection-offer`. The offer arrives as a
 * chip beside the selection and opens into the ordinary draft form.
 */
export function SelectionOffer() {
  const inference = createInferenceSource(undefined, 'selection');
  onCleanup(inference.dispose);
  const selection = createSelectionOffer({ classify: inference.classify });
  const [draft, setDraft] = createSignal<OpenDraft>();
  const [room, setRoom] = createSignal<number>();

  const close = () => {
    setDraft(undefined);
    selection.dismiss();
  };
  const accept = () => {
    const offer = selection.offer();
    const live = document.getSelection();
    if (!offer || !live?.rangeCount) return;
    selection.hold();
    // The last card's room belongs to the text it was opened on.
    setRoom(undefined);
    setDraft({ ...offer, anchor: live.getRangeAt(0).cloneRange() });
  };

  // Text that leaves the page — a deleted message, a closed split — leaves
  // the card with nothing to create from.
  createEffect(() => {
    const container = draft()?.container;
    if (!container) return;
    const observer = new MutationObserver(() => {
      if (!container.isConnected) close();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    onCleanup(() => observer.disconnect());
  });

  return (
    <>
      <Show when={!draft() && selection.offer()}>
        {(offer) => (
          <ScopedPortal scope="global">
            <button
              type="button"
              data-testid="selection-offer"
              class="fixed top-0 left-0 z-action-menu flex items-center gap-1.5 rounded-full border border-edge bg-surface px-2.5 py-1 font-medium text-ink text-xs shadow-menu hover:overlay-hover"
              use:floatWithSelection={{
                selection: document.getSelection(),
                reactiveOnContainer: offer().container,
                moveWithSelection: true,
                floatingOptions: { placement: 'top' },
              }}
              on:mousedown={(event: MouseEvent) => {
                // A default mousedown collapses the selection, which would
                // retract the offer before the click reached it.
                event.preventDefault();
              }}
              onClick={accept}
            >
              <TypeIcon intent={offer().intent} class="size-3.5 shrink-0" />
              {actionLabels[offer().intent]}
            </button>
          </ScopedPortal>
        )}
      </Show>
      <Show when={draft()}>
        {(open) => (
          <ScopedPortal scope="global">
            <div
              data-testid="selection-draft"
              class="fixed top-0 left-0 z-action-menu w-88 max-w-[calc(100vw-2rem)]"
              use:floatWithSelection={{
                selection: undefined,
                anchor: open().anchor,
                reactiveOnContainer: open().container,
                fullHeight: CARD_HEIGHT,
                onAvailableHeight: setRoom,
              }}
            >
              <Suspense>
                <SelectionDraft offer={open()} room={room()} onClose={close} />
              </Suspense>
            </div>
          </ScopedPortal>
        )}
      </Show>
    </>
  );
}
