import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import ArrowDown from '@icon/system/regular/arrow-down.svg';
import ArrowLineDown from '@icon/system/regular/arrow-line-down.svg';
import ArrowLineUp from '@icon/system/regular/arrow-line-up.svg';
import ArrowUp from '@icon/system/regular/arrow-up.svg';
import Check from '@icon/system/regular/check.svg';
import Clipboard from '@icon/system/regular/clipboard.svg';
import ClipboardText from '@icon/system/regular/clipboard-text.svg';
import Code from '@icon/system/regular/code.svg';
import Copy from '@icon/system/regular/copy.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import Image from '@icon/system/regular/image.svg';
import Link from '@icon/system/regular/link.svg';
import Scissors from '@icon/system/regular/scissors.svg';
import Selection from '@icon/system/regular/selection.svg';
import SelectionAll from '@icon/system/regular/selection-all.svg';
import SelectionPlus from '@icon/system/regular/selection-plus.svg';
import SelectionSlash from '@icon/system/regular/selection-slash.svg';
import Trash from '@icon/system/regular/trash-simple.svg';
import UploadSimple from '@icon/system/regular/upload-simple.svg';
import { CopyFeedback } from '@ui';
import { createCopyState } from '@ui/utils/create-copy-state';
import {
  type Component,
  type ComponentProps,
  For,
  type JSX,
  type ParentProps,
  Show,
  splitProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CanvasSnapMode } from '../../core/snapping';

/** A bottom sheet of rows, titled for screen readers only. */
function CanvasSheet(
  props: ParentProps<{
    title: string;
    open: boolean;
    onClose: () => void;
    /** Stays open through the lift of the long press that opened it. */
    openedByLongPress?: boolean;
  }>
) {
  return (
    <MobileDrawer
      open={props.open}
      closeOnOutsidePointerStrategy={
        props.openedByLongPress ? 'pointerdown' : undefined
      }
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={props.title}>
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody>
            <div class="flex flex-col gap-3">{props.children}</div>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

function SheetRow(
  props: Omit<ComponentProps<'button'>, 'children'> & {
    icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
    label: string;
    /** Draws a check at the end: the row is the chosen one, or switched on. */
    checked?: boolean;
  }
) {
  const [local, rest] = splitProps(props, ['icon', 'label', 'checked']);
  return (
    <MobileDrawer.Item
      {...rest}
      role={local.checked === undefined ? undefined : 'menuitemcheckbox'}
      aria-checked={local.checked}
    >
      <Show when={local.icon}>
        {(icon) => <Dynamic component={icon()} class="size-5 shrink-0" />}
      </Show>
      <span class="min-w-0 flex-1 truncate">{local.label}</span>
      <Show when={local.checked}>
        <Check class="size-5 shrink-0" />
      </Show>
    </MobileDrawer.Item>
  );
}

/**
 * Copy leaves the sheet open and turns its icon into a check once the
 * selection is on the clipboard, as copy actions do in every menu.
 */
function CopyRow(props: { disabled: boolean; onCopy: () => Promise<boolean> }) {
  const { copy, copied } = createCopyState();
  return (
    <MobileDrawer.Item
      disabled={props.disabled}
      onClick={() => copy(props.onCopy)}
    >
      <CopyFeedback copied={copied()}>
        <Copy class="size-5 shrink-0" />
      </CopyFeedback>
      <span class="min-w-0 flex-1 truncate">Copy</span>
    </MobileDrawer.Item>
  );
}

const ZOOM_PRESETS = [50, 100, 200];

const SNAP_MODES: { mode: CanvasSnapMode; label: string }[] = [
  { mode: 'none', label: 'No grid snapping' },
  { mode: 'pixel', label: 'Snap to px' },
  { mode: 'auto', label: 'Auto snapping' },
];

/**
 * Zoom, and on an editable canvas the grid and snapping, as a sheet: what the
 * desktop inspector's zoom menu offers.
 */
export function MobileCanvasViewSheet(props: {
  open: boolean;
  onClose: () => void;
  scale: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
  hasSelection: boolean;
  onFitSelection: () => void;
  /** Absent on a canvas that cannot be edited: it has no grid to snap to. */
  editing?: {
    grid: boolean;
    onGrid: (visible: boolean) => void;
    snapToObjects: boolean;
    onSnapToObjects: (enabled: boolean) => void;
    snapMode: CanvasSnapMode;
    onSnapMode: (mode: CanvasSnapMode) => void;
    /** A drawing tool stays chosen after it has drawn. */
    toolLocked: boolean;
    onToolLocked: (locked: boolean) => void;
    /**
     * Only the pen draws, and fingers move the canvas. Absent until a pen has
     * pressed the canvas: without one there is nothing to choose.
     */
    penOnly?: boolean;
    onPenOnly: (only: boolean) => void;
  };
}) {
  const percent = () => Math.round(props.scale * 100);
  /** Zooming and fitting are done once chosen; toggles stay to be compared. */
  const closeAfter = (action: () => void) => () => {
    action();
    props.onClose();
  };
  return (
    <CanvasSheet title="View" open={props.open} onClose={props.onClose}>
      <MobileDrawer.Section>
        <SheetRow label="Zoom to fit" onClick={closeAfter(props.onFit)} />
        <SheetRow
          label="Zoom to selection"
          disabled={!props.hasSelection}
          onClick={closeAfter(props.onFitSelection)}
        />
        <For each={ZOOM_PRESETS}>
          {(preset) => (
            <SheetRow
              label={`Zoom to ${preset}%`}
              checked={percent() === preset}
              onClick={closeAfter(() =>
                props.onZoom(preset / 100 / props.scale)
              )}
            />
          )}
        </For>
      </MobileDrawer.Section>
      <Show when={props.editing}>
        {(editing) => (
          <>
            <MobileDrawer.Section>
              <SheetRow
                label="Dot grid"
                checked={editing().grid}
                onClick={() => editing().onGrid(!editing().grid)}
              />
              <SheetRow
                label="Snap to objects"
                checked={editing().snapToObjects}
                onClick={() =>
                  editing().onSnapToObjects(!editing().snapToObjects)
                }
              />
            </MobileDrawer.Section>
            <MobileDrawer.Section>
              <For each={SNAP_MODES}>
                {(option) => (
                  <SheetRow
                    label={option.label}
                    checked={editing().snapMode === option.mode}
                    onClick={() => editing().onSnapMode(option.mode)}
                  />
                )}
              </For>
            </MobileDrawer.Section>
            <MobileDrawer.Section>
              <SheetRow
                label="Keep tool after drawing"
                checked={editing().toolLocked}
                onClick={() => editing().onToolLocked(!editing().toolLocked)}
              />
              <Show when={editing().penOnly !== undefined}>
                <SheetRow
                  label="Draw with pen only"
                  checked={!!editing().penOnly}
                  onClick={() => editing().onPenOnly(!editing().penOnly)}
                />
              </Show>
            </MobileDrawer.Section>
          </>
        )}
      </Show>
    </CanvasSheet>
  );
}

/**
 * Clipboard, grouping, layer order and select all: every action the desktop
 * context menu has, for the selection bar's More and for a long press.
 */
export function MobileCanvasActionsSheet(props: {
  open: boolean;
  onClose: () => void;
  openedByLongPress: boolean;
  hasSelection: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  onCut: () => void;
  /** Resolves to whether the selection reached the clipboard. */
  onCopy: () => Promise<boolean>;
  onPaste: () => void;
  onPasteInPlace: () => void;
  onDuplicate: () => void;
  onSelectAll: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  /**
   * Present when a long press landed on an item inside the selected group:
   * selects that item alone, as Cmd/Ctrl-click does with a mouse.
   */
  onSelectInside?: () => void;
  onReorder: (operation: 'front' | 'forward' | 'backward' | 'back') => void;
  onDelete: () => void;
  /** Present with exactly one image selected. */
  image?: { disabled: boolean; onCopy: () => void; onSave: () => void };
}) {
  const run = (action: () => void) => () => {
    props.onClose();
    action();
  };
  return (
    <CanvasSheet
      title="Canvas actions"
      open={props.open}
      onClose={props.onClose}
      openedByLongPress={props.openedByLongPress}
    >
      <MobileDrawer.Section>
        <SheetRow
          icon={Scissors}
          label="Cut"
          disabled={!props.hasSelection}
          onClick={run(props.onCut)}
        />
        <CopyRow disabled={!props.hasSelection} onCopy={props.onCopy} />
        <SheetRow icon={Clipboard} label="Paste" onClick={run(props.onPaste)} />
        <SheetRow
          icon={ClipboardText}
          label="Paste in place"
          onClick={run(props.onPasteInPlace)}
        />
        <SheetRow
          icon={Copy}
          label="Duplicate"
          disabled={!props.hasSelection}
          onClick={run(props.onDuplicate)}
        />
        <SheetRow
          icon={SelectionAll}
          label="Select all"
          onClick={run(props.onSelectAll)}
        />
      </MobileDrawer.Section>
      <Show when={props.image}>
        {(image) => (
          <MobileDrawer.Section>
            <SheetRow
              icon={Copy}
              label="Copy image"
              disabled={image().disabled}
              onClick={run(() => image().onCopy())}
            />
            <SheetRow
              icon={DownloadSimple}
              label="Save image"
              disabled={image().disabled}
              onClick={run(() => image().onSave())}
            />
          </MobileDrawer.Section>
        )}
      </Show>
      <MobileDrawer.Section>
        <SheetRow
          icon={SelectionPlus}
          label="Group"
          disabled={!props.canGroup}
          onClick={run(props.onGroup)}
        />
        <SheetRow
          icon={SelectionSlash}
          label="Ungroup"
          disabled={!props.canUngroup}
          onClick={run(props.onUngroup)}
        />
        <Show when={props.onSelectInside}>
          {(onSelectInside) => (
            <SheetRow
              icon={Selection}
              label="Select inside group"
              onClick={run(onSelectInside())}
            />
          )}
        </Show>
      </MobileDrawer.Section>
      <MobileDrawer.Section>
        <SheetRow
          icon={ArrowLineUp}
          label="Bring to front"
          disabled={!props.hasSelection}
          onClick={run(() => props.onReorder('front'))}
        />
        <SheetRow
          icon={ArrowUp}
          label="Bring forward"
          disabled={!props.hasSelection}
          onClick={run(() => props.onReorder('forward'))}
        />
        <SheetRow
          icon={ArrowDown}
          label="Send backward"
          disabled={!props.hasSelection}
          onClick={run(() => props.onReorder('backward'))}
        />
        <SheetRow
          icon={ArrowLineDown}
          label="Send to back"
          disabled={!props.hasSelection}
          onClick={run(() => props.onReorder('back'))}
        />
      </MobileDrawer.Section>
      <MobileDrawer.Section>
        <SheetRow
          icon={Trash}
          label="Delete"
          class="text-failure-ink"
          disabled={!props.hasSelection}
          onClick={run(props.onDelete)}
        />
      </MobileDrawer.Section>
    </CanvasSheet>
  );
}

/**
 * What the Attach button offers, as a sheet: the choices of the desktop Attach
 * menu, in its order.
 */
export function MobileCanvasInsertSheet(props: {
  open: boolean;
  onClose: () => void;
  onMedia: () => void;
  onUpload: () => void;
  onReference: () => void;
  onArtifact: () => void;
}) {
  return (
    <CanvasSheet title="Attach" open={props.open} onClose={props.onClose}>
      <div>
        <SheetRow icon={Image} label="Media" onClick={props.onMedia} />
        <SheetRow
          icon={UploadSimple}
          label="Upload media"
          onClick={props.onUpload}
        />
        <SheetRow icon={Link} label="Reference" onClick={props.onReference} />
        <SheetRow icon={Code} label="Artifact" onClick={props.onArtifact} />
      </div>
    </CanvasSheet>
  );
}
