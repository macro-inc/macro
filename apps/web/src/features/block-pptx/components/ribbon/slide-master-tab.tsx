/**
 * The Slide Master tab Slide Master view shows first, as in PowerPoint:
 * Edit Master (Insert Layout, Delete, Rename), Master Layout (Insert
 * Placeholder, Title, Footers), Background (theme Colors and Fonts, Format
 * Background, Hide Background Graphics), Size, and Close Master View.
 */

import ChartBar from '@phosphor/chart-bar.svg';
import FilmStrip from '@phosphor/film-strip.svg';
import ImageIcon from '@phosphor/image.svg';
import Layout from '@phosphor/layout.svg';
import PaintBucket from '@phosphor/paint-bucket.svg';
import PencilSimpleLine from '@phosphor/pencil-simple-line.svg';
import RectangleDashed from '@phosphor/rectangle-dashed.svg';
import SquaresFour from '@phosphor/squares-four.svg';
import Table from '@phosphor/table.svg';
import Textbox from '@phosphor/textbox.svg';
import Trash from '@phosphor/trash.svg';
import TreeStructure from '@phosphor/tree-structure.svg';
import XCircle from '@phosphor/x-circle.svg';
import { For, type JSX } from 'solid-js';
import {
  backgroundStylePreview,
  PLACEHOLDER_CHOICES,
} from '../../core/master-view';
import { COLOR_SETS, FONT_PAIRS } from '../../core/themes';
import type { MasterView } from '../../primitives/create-master-view';
import {
  PopoverItem,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './controls';
import { SlideSizeGroup } from './deck-setup-controls';
import { useRibbon } from './ribbon';

const PLACEHOLDER_ICONS: Record<string, () => JSX.Element> = {
  content: () => <SquaresFour />,
  text: () => <Textbox />,
  picture: () => <ImageIcon />,
  chart: () => <ChartBar />,
  table: () => <Table />,
  smartArt: () => <TreeStructure />,
  media: () => <FilmStrip />,
};

/** A labelled checkbox, as the Slide Master tab shows Title and Footers. */
function RibbonCheckbox(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  testId: string;
  tooltip?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      class="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs"
      classList={{ 'opacity-50': props.disabled }}
      title={props.tooltip}
    >
      <input
        type="checkbox"
        class="accent-accent"
        data-testid={props.testId}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

export function SlideMasterTab(props: { master: MasterView }) {
  const env = useRibbon();
  const m = props.master;
  const ro = () => env.readonly();
  const layout = () => m.page()?.layout;
  const options = () => m.options();
  return (
    <>
      <RibbonGroup label="Edit Master">
        <RibbonTextButton
          label="Insert Layout"
          tooltip="Insert Layout: add a layout to the slide master"
          disabled={ro() || !m.page()}
          data-testid="pptx-master-insert-layout"
          onClick={() => void m.insertLayout()}
        >
          <Layout />
          Insert Layout
        </RibbonTextButton>
        <RibbonTextButton
          label="Delete"
          tooltip={
            m.deleteBlocker() ??
            (layout() ? 'Delete this layout' : 'Delete this slide master')
          }
          disabled={ro() || !m.page() || !!m.deleteBlocker()}
          data-testid="pptx-master-delete"
          onClick={() => void m.deletePage()}
        >
          <Trash />
          Delete
        </RibbonTextButton>
        <RibbonTextButton
          label="Rename"
          tooltip={layout() ? 'Rename this layout' : 'Rename this slide master'}
          disabled={ro() || !m.page()}
          data-testid="pptx-master-rename"
          onClick={() => m.startRename()}
        >
          <PencilSimpleLine />
          Rename
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Master Layout">
        <RibbonPopover
          label="Insert Placeholder"
          text="Insert Placeholder"
          icon={<RectangleDashed class="size-3.5" />}
          disabled={ro() || !layout()}
          testId="pptx-master-insert-placeholder"
        >
          {(close) => (
            <div
              class="flex w-48 flex-col"
              data-testid="pptx-master-placeholder-menu"
            >
              <For each={PLACEHOLDER_CHOICES}>
                {(choice) => (
                  <PopoverItem
                    label={choice.label}
                    icon={PLACEHOLDER_ICONS[choice.kind]()}
                    testId={`pptx-master-placeholder-${choice.kind}${choice.vertical ? '-vertical' : ''}`}
                    onClick={() => {
                      close();
                      void m.insertPlaceholder(choice.kind, choice.vertical);
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <RibbonCheckbox
          label="Title"
          testId="pptx-master-title"
          tooltip="Show the title placeholder on this layout"
          checked={options().title}
          disabled={ro() || !layout()}
          onChange={(title) => void m.setOptions({ title })}
        />
        <RibbonCheckbox
          label="Footers"
          testId="pptx-master-footers"
          tooltip="Show the date, footer, and slide number placeholders on this layout"
          checked={options().footers}
          disabled={ro() || !layout()}
          onChange={(footers) => void m.setOptions({ footers })}
        />
      </RibbonGroup>
      <RibbonGroup label="Background">
        <ThemeColorsMenu />
        <ThemeFontsMenu />
        <BackgroundStylesMenu master={m} />
        <RibbonTextButton
          label="Format Background"
          tooltip="Format the background of this master or layout"
          disabled={ro()}
          data-testid="pptx-master-format-background"
          onClick={() => env.openFormatPane('background')}
        >
          <PaintBucket />
          Format Background
        </RibbonTextButton>
        <RibbonCheckbox
          label="Hide Background Graphics"
          testId="pptx-master-hide-background"
          tooltip="Hide the slide master's shapes on this layout"
          checked={!!layout()?.hideBackgroundGraphics}
          disabled={ro() || !layout()}
          onChange={(hide) =>
            void m.setOptions({ hideBackgroundGraphics: hide })
          }
        />
      </RibbonGroup>
      <SlideSizeGroup />
      <RibbonGroup label="Close">
        <RibbonTextButton
          label="Close Master View"
          tooltip="Close Master View: back to editing slides"
          variant="accent"
          data-testid="pptx-master-close"
          onClick={() => void m.close()}
        >
          <XCircle />
          Close Master View
        </RibbonTextButton>
      </RibbonGroup>
    </>
  );
}

/** Background ▸ Colors: the theme color sets, as on the Design tab. */
function ThemeColorsMenu() {
  const env = useRibbon();
  const accents = () =>
    (env.deck()?.themeColors ?? [])
      .filter(([slot]) => slot.startsWith('accent'))
      .map(([, css]) => css.replace('#', '').toUpperCase());
  return (
    <RibbonPopover
      label="Theme colors"
      text="Colors"
      icon={
        <span class="flex gap-px">
          <For each={accents()}>
            {(hex) => (
              <span
                class="h-3 w-1 rounded-sm"
                style={{ background: `#${hex}` }}
              />
            )}
          </For>
        </span>
      }
      disabled={env.readonly()}
      testId="pptx-master-theme-colors"
    >
      {(close) => (
        <div class="flex max-h-[60vh] w-64 flex-col overflow-y-auto">
          <For each={COLOR_SETS}>
            {(set) => (
              <PopoverItem
                label={set.name}
                active={accents().every(
                  (hex, i) => set.colors[`accent${i + 1}`] === hex
                )}
                icon={
                  <span
                    class="block size-3.5 border border-edge-muted"
                    style={{ background: `#${set.colors.accent1}` }}
                  />
                }
                onClick={() => {
                  close();
                  void env.commands.setThemeColors(set.colors, set.name);
                }}
              />
            )}
          </For>
        </div>
      )}
    </RibbonPopover>
  );
}

/** Background ▸ Fonts: the theme font pairs, as on the Design tab. */
function ThemeFontsMenu() {
  const env = useRibbon();
  return (
    <RibbonPopover
      label="Theme fonts"
      text="Fonts"
      icon={<span class="font-serif text-sm leading-none">Aa</span>}
      disabled={env.readonly()}
      testId="pptx-master-theme-fonts"
    >
      {(close) => (
        <div class="flex max-h-[60vh] w-64 flex-col overflow-y-auto">
          <For each={FONT_PAIRS}>
            {(pair) => (
              <PopoverItem
                label={`${pair.name}: ${pair.major} / ${pair.minor}`}
                active={
                  env.deck()?.themeFonts?.major === pair.major &&
                  env.deck()?.themeFonts?.minor === pair.minor
                }
                onClick={() => {
                  close();
                  void env.commands.setThemeFonts(
                    pair.major,
                    pair.minor,
                    pair.name
                  );
                }}
              />
            )}
          </For>
        </div>
      )}
    </RibbonPopover>
  );
}

/**
 * Background ▸ Background Styles: the theme's twelve background styles
 * (three fills by four colors), Format Background, and Reset.
 */
function BackgroundStylesMenu(props: { master: MasterView }) {
  const env = useRibbon();
  const colors = () => env.deck()?.themeColors ?? [];
  return (
    <RibbonPopover
      label="Background Styles"
      text="Background Styles"
      icon={
        <span
          class="size-3.5 rounded-sm border border-edge-muted"
          style={{ background: backgroundStylePreview(colors(), 9) }}
        />
      }
      disabled={env.readonly() || !props.master.page()}
      testId="pptx-master-background-styles"
    >
      {(close) => (
        <div class="flex w-64 flex-col gap-2">
          <div class="grid grid-cols-4 gap-1.5 p-1">
            <For each={Array.from({ length: 12 }, (_, i) => i + 1)}>
              {(style) => (
                <button
                  type="button"
                  title={`Style ${style}`}
                  aria-label={`Style ${style}`}
                  data-testid={`pptx-master-background-style-${style}`}
                  class="aspect-[4/3] rounded-sm border border-edge-muted hover:outline hover:outline-2 hover:outline-accent"
                  style={{
                    background: backgroundStylePreview(colors(), style),
                  }}
                  onClick={() => {
                    close();
                    void props.master.setBackgroundStyle(style);
                  }}
                />
              )}
            </For>
          </div>
          <PopoverItem
            label="Format Background…"
            icon={<PaintBucket class="size-3.5" />}
            onClick={() => {
              close();
              env.openFormatPane('background');
            }}
          />
          <PopoverItem
            label="Reset Background"
            testId="pptx-master-background-reset"
            onClick={() => {
              close();
              env.commands.setBackground(null);
            }}
          />
        </div>
      )}
    </RibbonPopover>
  );
}
