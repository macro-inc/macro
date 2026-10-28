/**
 * The deck setup dialogs the editor shows: Header & Footer, Slide Size, and
 * the Maximize / Ensure Fit question.
 */

import type { DeckOutline, SlideOutline } from '@core/pptx-engine/types';
import { Show } from 'solid-js';
import type { DeckSetup } from '../primitives/create-deck-setup';
import { HeaderFooterDialog } from './header-footer-dialog';
import { ScaleContentDialog, SlideSizeDialog } from './slide-size-dialog';

export function DeckSetupDialogs(props: {
  setup: DeckSetup;
  deck: DeckOutline | undefined;
  slide: SlideOutline | undefined;
  selectedCount: number;
  readonly: boolean;
  /** A dialog closed (focus goes back to the slide). */
  onClosed: () => void;
}) {
  const setup = props.setup;
  return (
    <>
      <Show when={setup.headerFooterOpen() && props.deck}>
        {(deck) => (
          <HeaderFooterDialog
            deck={deck()}
            slide={props.slide}
            selectedCount={props.selectedCount}
            readonly={props.readonly}
            onApply={setup.applyHeaderFooter}
            onClose={() => {
              setup.setHeaderFooterOpen(false);
              props.onClosed();
            }}
          />
        )}
      </Show>
      <Show when={setup.slideSizeOpen() && props.deck}>
        {(deck) => (
          <SlideSizeDialog
            width={deck().width}
            height={deck().height}
            onOk={setup.requestSize}
            onClose={() => {
              setup.setSlideSizeOpen(false);
              props.onClosed();
            }}
          />
        )}
      </Show>
      <Show when={setup.pendingSize()}>
        <ScaleContentDialog
          onPick={(scale) => {
            setup.chooseScale(scale);
            props.onClosed();
          }}
        />
      </Show>
    </>
  );
}
