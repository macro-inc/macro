/**
 * Ribbon controls for deck setup: Insert ▸ Header & Footer, Date & Time, and
 * Slide Number (all open the Header & Footer dialog, as in PowerPoint);
 * Design ▸ Slide Size; and Home ▸ Section.
 */

import CalendarBlank from '@phosphor/calendar-blank.svg';
import Hash from '@phosphor/hash.svg';
import { Show } from 'solid-js';
import { presetOf } from '../../core/slide-size';
import {
  PopoverItem,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { useRibbon } from './ribbon';

/** A page with a header and a footer line. */
function HeaderFooterIcon() {
  return (
    <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
      <rect
        x="2.5"
        y="1.5"
        width="11"
        height="13"
        rx="1"
        class="fill-none stroke-current"
        stroke-width="1.2"
      />
      <path d="M4.5 4h7M4.5 12h7" class="stroke-current" stroke-width="1.6" />
    </svg>
  );
}

/** A slide outline in an aspect ratio (width / height). */
function AspectIcon(props: { ratio: number }) {
  const w = () => (props.ratio >= 1 ? 14 : 14 * props.ratio);
  const h = () => (props.ratio >= 1 ? 14 / props.ratio : 14);
  return (
    <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true">
      <rect
        x={8 - w() / 2}
        y={8 - h() / 2}
        width={w()}
        height={h()}
        rx="1"
        class="fill-none stroke-current"
        stroke-width="1.2"
      />
    </svg>
  );
}

/** Insert ▸ Text: Header & Footer, Date & Time, and Slide Number. */
export function HeaderFooterButtons() {
  const env = useRibbon();
  const open = () => env.deckSetup?.setHeaderFooterOpen(true);
  return (
    <Show when={env.deckSetup}>
      <RibbonTextButton
        label="Header & Footer"
        disabled={env.readonly()}
        data-testid="pptx-insert-header-footer"
        onClick={open}
      >
        <HeaderFooterIcon />
        Header & Footer
      </RibbonTextButton>
      <RibbonTextButton
        label="Date & Time"
        disabled={env.readonly()}
        data-testid="pptx-insert-date-time"
        onClick={open}
      >
        <CalendarBlank />
        Date & Time
      </RibbonTextButton>
      <RibbonTextButton
        label="Slide Number"
        disabled={env.readonly()}
        data-testid="pptx-insert-slide-number"
        onClick={open}
      >
        <Hash />
        Slide Number
      </RibbonTextButton>
    </Show>
  );
}

/** Design ▸ Customize ▸ Slide Size. */
export function SlideSizeGroup() {
  const env = useRibbon();
  const preset = () => {
    const deck = env.deck();
    return deck ? presetOf(deck.width, deck.height) : undefined;
  };
  const ratio = () => {
    const deck = env.deck();
    return deck ? deck.width / deck.height : 16 / 9;
  };
  return (
    <Show when={env.deckSetup}>
      {(setup) => (
        <RibbonGroup label="Customize">
          <RibbonPopover
            label="Slide Size"
            text="Slide Size"
            icon={<AspectIcon ratio={ratio()} />}
            disabled={env.readonly()}
            testId="pptx-slide-size"
            placement="bottom-end"
          >
            {(close) => (
              <div class="flex w-56 flex-col">
                <PopoverItem
                  label="Standard (4:3)"
                  icon={<AspectIcon ratio={4 / 3} />}
                  active={preset() === 'screen4x3'}
                  testId="pptx-slide-size-standard"
                  onClick={() => {
                    close();
                    setup().requestSize(720, 540);
                  }}
                />
                <PopoverItem
                  label="Widescreen (16:9)"
                  icon={<AspectIcon ratio={16 / 9} />}
                  active={preset() === 'widescreen'}
                  testId="pptx-slide-size-widescreen"
                  onClick={() => {
                    close();
                    setup().requestSize(960, 540);
                  }}
                />
                <div class="my-1 h-px bg-edge-muted" />
                <PopoverItem
                  label="Custom Slide Size…"
                  testId="pptx-slide-size-custom"
                  onClick={() => {
                    close();
                    setup().setSlideSizeOpen(true);
                  }}
                />
              </div>
            )}
          </RibbonPopover>
        </RibbonGroup>
      )}
    </Show>
  );
}

/** Home ▸ Slides ▸ Section. */
export function SectionMenu() {
  const env = useRibbon();
  return (
    <Show when={env.deckSetup}>
      {(setup) => {
        const s = setup().sections;
        const none = () => s.list().length === 0;
        return (
          <RibbonPopover
            label="Section"
            icon={
              <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
                <path
                  d="M2 3h12M2 8h12M2 13h12"
                  class="stroke-current"
                  stroke-width="1.2"
                />
                <path d="M2 1.5l2.5 1.5L2 4.5z" class="fill-current" />
              </svg>
            }
            text="Section"
            disabled={env.readonly()}
            testId="pptx-section-menu"
          >
            {(close) => (
              <div class="flex w-52 flex-col">
                <PopoverItem
                  label="Add Section"
                  testId="pptx-section-add"
                  onClick={() => {
                    close();
                    void s.add();
                  }}
                />
                <PopoverItem
                  label="Rename Section"
                  testId="pptx-section-rename-current"
                  disabled={none()}
                  onClick={() => {
                    close();
                    s.startRename(s.current()?.id);
                  }}
                />
                <PopoverItem
                  label="Remove Section"
                  testId="pptx-section-remove"
                  disabled={none()}
                  onClick={() => {
                    close();
                    const id = s.current()?.id;
                    if (id) s.remove(id);
                  }}
                />
                <PopoverItem
                  label="Remove All Sections"
                  testId="pptx-section-remove-all"
                  disabled={none()}
                  onClick={() => {
                    close();
                    s.removeAll();
                  }}
                />
                <div class="my-1 h-px bg-edge-muted" />
                <PopoverItem
                  label="Collapse All"
                  testId="pptx-section-collapse-all"
                  disabled={none()}
                  onClick={() => {
                    close();
                    s.collapseAll();
                  }}
                />
                <PopoverItem
                  label="Expand All"
                  testId="pptx-section-expand-all"
                  disabled={none()}
                  onClick={() => {
                    close();
                    s.expandAll();
                  }}
                />
              </div>
            )}
          </RibbonPopover>
        );
      }}
    </Show>
  );
}
