/**
 * The menu bar's menus (File, Edit, Image, Layer, Select, Filter, View),
 * built from what the editor can do now.
 */

import type { MenuDefinition, MenuEntry } from '../components/menu-bar';
import { ADJUSTMENT_LABELS, ADJUSTMENT_TYPES } from '../core/adjustments';
import { FILTER_KINDS, FILTER_TITLES } from '../core/filters';
import type { PsdCommands } from '../primitives/create-psd-commands';
import type { PsdEditor } from '../primitives/create-psd-editor';
import type { PsdView } from '../primitives/create-psd-view';

export function buildMenus(args: {
  editor: PsdEditor;
  view: PsdView;
  commands: PsdCommands;
  mac: boolean;
}): MenuDefinition[] {
  const { editor, view, commands } = args;
  const r = commands.run;
  const can = commands.available;
  const edit = editor.enabled();
  const k = (mac: string, other: string) => (args.mac ? mac : other);
  const mod = (key: string) => k(`⌘${key}`, `Ctrl+${key}`);
  const shiftMod = (key: string) => k(`⇧⌘${key}`, `Ctrl+⇧${key}`);

  const file: MenuEntry[] = [
    {
      label: 'Download .psd',
      onSelect: r.downloadPsd,
      testId: 'psd-menu-download',
    },
    'divider',
    {
      label: 'Export as PNG',
      onSelect: r.exportPng,
      testId: 'psd-menu-export-png',
    },
    {
      label: 'Export as JPEG',
      onSelect: r.exportJpeg,
      testId: 'psd-menu-export-jpeg',
    },
    {
      label: 'Export Layer as PNG',
      disabled: !can.layer(),
      onSelect: r.exportLayer,
      testId: 'psd-menu-export-layer',
    },
  ];

  const editMenu: MenuEntry[] = [
    {
      label: 'Undo',
      shortcut: mod('Z'),
      disabled: !edit || !editor.canUndo(),
      onSelect: r.undo,
      testId: 'psd-menu-undo',
    },
    {
      label: 'Redo',
      shortcut: shiftMod('Z'),
      disabled: !edit || !editor.canRedo(),
      onSelect: r.redo,
      testId: 'psd-menu-redo',
    },
    'divider',
    {
      label: 'Cut',
      shortcut: mod('X'),
      disabled: !edit || !can.selection(),
      onSelect: r.cut,
    },
    {
      label: 'Copy',
      shortcut: mod('C'),
      disabled: !can.layer(),
      onSelect: r.copy,
      testId: 'psd-menu-copy',
    },
    { label: 'Copy Merged', shortcut: shiftMod('C'), onSelect: r.copyMerged },
    {
      label: 'Paste',
      shortcut: mod('V'),
      disabled: !edit || !can.clipboard(),
      onSelect: r.paste,
      testId: 'psd-menu-paste',
    },
    'divider',
    {
      label: 'Fill with Foreground',
      shortcut: k('⌥⌫', 'Alt+⌫'),
      disabled: !edit || !can.pixels(),
      onSelect: r.fillForeground,
      testId: 'psd-menu-fill',
    },
    {
      label: 'Fill with Background',
      shortcut: mod('⌫'),
      disabled: !edit || !can.pixels(),
      onSelect: r.fillBackground,
    },
    {
      label: 'Clear',
      shortcut: '⌫',
      disabled: !edit || !can.selection(),
      onSelect: r.delete,
    },
    'divider',
    {
      label: 'Free Transform',
      shortcut: mod('T'),
      disabled: !edit || !can.layer(),
      onSelect: r.freeTransform,
      testId: 'psd-menu-free-transform',
    },
    {
      label: 'Transform',
      disabled: !edit || !can.layer(),
      items: [
        { label: 'Rotate 180°', onSelect: () => r.rotateLayer(2) },
        { label: 'Rotate 90° Clockwise', onSelect: () => r.rotateLayer(1) },
        {
          label: 'Rotate 90° Counter Clockwise',
          onSelect: () => r.rotateLayer(3),
        },
        'divider',
        {
          label: 'Flip Horizontal',
          onSelect: () => r.flipLayer(true),
          testId: 'psd-menu-flip-layer-h',
        },
        { label: 'Flip Vertical', onSelect: () => r.flipLayer(false) },
      ],
    },
  ];

  const image: MenuEntry[] = [
    {
      label: 'Mode',
      items: [
        {
          label: 'RGB Color',
          checked: editor.summary().mode === 'rgb',
          disabled:
            editor.summary().mode === 'rgb' && editor.summary().depth === 8,
          onSelect: r.convertToRgb,
          testId: 'psd-menu-convert-rgb',
        },
      ],
    },
    {
      label: 'Adjustments',
      disabled: !edit || !can.pixels(),
      items: [
        ...ADJUSTMENT_TYPES.map((type) => ({
          label: `${ADJUSTMENT_LABELS[type]}…`,
          testId: `psd-menu-adjust-${type}`,
          onSelect: () => r.openAdjust(type),
        })),
        'divider' as const,
        { label: 'Desaturate', onSelect: r.desaturate },
      ],
    },
    'divider',
    {
      label: 'Image Size…',
      disabled: !edit,
      onSelect: () => r.openDialog({ kind: 'imageSize' }),
      testId: 'psd-menu-image-size',
    },
    {
      label: 'Canvas Size…',
      disabled: !edit,
      onSelect: () => r.openDialog({ kind: 'canvasSize' }),
      testId: 'psd-menu-canvas-size',
    },
    {
      label: 'Resolution…',
      disabled: !edit,
      onSelect: () => r.openDialog({ kind: 'resolution' }),
    },
    {
      label: 'Image Rotation',
      disabled: !edit,
      items: [
        { label: '180°', onSelect: () => r.rotateCanvas(2) },
        {
          label: '90° Clockwise',
          onSelect: () => r.rotateCanvas(1),
          testId: 'psd-menu-rotate-cw',
        },
        { label: '90° Counter Clockwise', onSelect: () => r.rotateCanvas(3) },
        'divider',
        { label: 'Flip Canvas Horizontal', onSelect: () => r.flipCanvas(true) },
        { label: 'Flip Canvas Vertical', onSelect: () => r.flipCanvas(false) },
      ],
    },
    {
      label: 'Crop to Selection',
      disabled: !edit || !can.selection(),
      onSelect: r.cropToSelection,
      testId: 'psd-menu-crop-selection',
    },
    'divider',
    {
      label: 'Flatten Image',
      disabled: !edit,
      onSelect: r.flatten,
      testId: 'psd-menu-flatten',
    },
  ];

  const layer: MenuEntry[] = [
    {
      label: 'New Layer',
      shortcut: shiftMod('N'),
      disabled: !edit,
      onSelect: r.newLayer,
      testId: 'psd-menu-new-layer',
    },
    { label: 'New Group', disabled: !edit, onSelect: r.newGroup },
    {
      label: 'New Fill Layer',
      disabled: !edit,
      items: [
        { label: 'Solid Color', onSelect: () => void r.newFill('solid') },
        { label: 'Gradient', onSelect: () => void r.newFill('gradient') },
      ],
    },
    {
      label: 'New Adjustment Layer',
      disabled: !edit,
      items: ADJUSTMENT_TYPES.map((type) => ({
        label: ADJUSTMENT_LABELS[type],
        onSelect: () => void r.newAdjustment(type),
      })),
    },
    'divider',
    {
      label: 'Duplicate Layer',
      disabled: !edit || !can.layer(),
      onSelect: r.duplicate,
    },
    {
      label: 'Delete Layer',
      disabled: !edit || !can.layer(),
      onSelect: r.deleteLayers,
    },
    {
      label: 'Layer via Copy',
      shortcut: mod('J'),
      disabled: !edit || !can.pixels(),
      onSelect: r.layerViaCopy,
    },
    {
      label: 'Layer via Cut',
      shortcut: shiftMod('J'),
      disabled: !edit || !can.pixels(),
      onSelect: r.layerViaCut,
    },
    'divider',
    {
      label: 'Layer Mask',
      disabled: !edit || !can.layer(),
      items: can.mask()
        ? [
            { label: 'Disable / Enable', onSelect: r.toggleMask },
            { label: 'Apply', onSelect: () => r.deleteMask(true) },
            { label: 'Delete', onSelect: () => r.deleteMask(false) },
          ]
        : [
            {
              label: 'Reveal All',
              onSelect: () => r.addMask('revealAll'),
              testId: 'psd-menu-mask-reveal-all',
            },
            { label: 'Hide All', onSelect: () => r.addMask('hideAll') },
            {
              label: 'Reveal Selection',
              disabled: !can.selection(),
              onSelect: () => r.addMask('revealSelection'),
            },
            {
              label: 'Hide Selection',
              disabled: !can.selection(),
              onSelect: () => r.addMask('hideSelection'),
            },
          ],
    },
    {
      label: 'Create / Release Clipping Mask',
      shortcut: k('⌥⌘G', 'Ctrl+Alt+G'),
      disabled: !edit || !can.layer(),
      onSelect: r.clippingMask,
    },
    'divider',
    {
      label: 'Group Layers',
      shortcut: mod('G'),
      disabled: !edit || !can.layer(),
      onSelect: r.group,
      testId: 'psd-menu-group',
    },
    {
      label: 'Ungroup Layers',
      shortcut: shiftMod('G'),
      disabled: !edit || !can.group(),
      onSelect: r.ungroup,
    },
    {
      label: 'Rasterize',
      disabled: !edit || !can.layer(),
      onSelect: r.rasterize,
    },
    'divider',
    {
      label: 'Merge Down',
      shortcut: mod('E'),
      disabled: !edit || !can.mergeDown(),
      onSelect: r.mergeDown,
      testId: 'psd-menu-merge-down',
    },
    { label: 'Merge Visible', disabled: !edit, onSelect: r.mergeVisible },
    { label: 'Flatten Image', disabled: !edit, onSelect: r.flatten },
  ];

  const select: MenuEntry[] = [
    {
      label: 'All',
      shortcut: mod('A'),
      onSelect: r.selectAll,
      testId: 'psd-menu-select-all',
    },
    {
      label: 'Deselect',
      shortcut: mod('D'),
      disabled: !can.selection(),
      onSelect: r.deselect,
      testId: 'psd-menu-deselect',
    },
    { label: 'Inverse', shortcut: shiftMod('I'), onSelect: r.invertSelection },
    'divider',
    {
      label: 'Feather…',
      shortcut: '⇧F6',
      disabled: !can.selection(),
      onSelect: () => r.openDialog({ kind: 'feather' }),
    },
    {
      label: 'Expand…',
      disabled: !can.selection(),
      onSelect: () => r.openDialog({ kind: 'expand', contract: false }),
    },
    {
      label: 'Contract…',
      disabled: !can.selection(),
      onSelect: () => r.openDialog({ kind: 'expand', contract: true }),
    },
    'divider',
    {
      label: 'Load Layer Transparency',
      disabled: !can.layer(),
      onSelect: r.loadTransparency,
    },
  ];

  const filter: MenuEntry[] = [
    ...FILTER_KINDS.map((kind) => ({
      label: `${FILTER_TITLES[kind]}…`,
      disabled: !edit || !can.pixels(),
      testId: `psd-menu-filter-${kind}`,
      onSelect: () => r.openFilter(kind),
    })),
  ];

  const viewMenu: MenuEntry[] = [
    { label: 'Zoom In', shortcut: mod('+'), onSelect: r.zoomIn },
    { label: 'Zoom Out', shortcut: mod('−'), onSelect: r.zoomOut },
    {
      label: 'Fit on Screen',
      shortcut: mod('0'),
      onSelect: r.zoomFit,
      testId: 'psd-menu-fit',
    },
    {
      label: '100%',
      shortcut: mod('1'),
      onSelect: r.zoom100,
      testId: 'psd-menu-100',
    },
    'divider',
    {
      label: 'Pixel Grid',
      checked: view.pixelGrid(),
      onSelect: r.togglePixelGrid,
    },
  ];

  return [
    { title: 'File', testId: 'psd-menu-file', items: file },
    { title: 'Edit', testId: 'psd-menu-edit', items: editMenu },
    { title: 'Image', testId: 'psd-menu-image', items: image },
    { title: 'Layer', testId: 'psd-menu-layer', items: layer },
    { title: 'Select', testId: 'psd-menu-select', items: select },
    { title: 'Filter', testId: 'psd-menu-filter', items: filter },
    { title: 'View', testId: 'psd-menu-view', items: viewMenu },
  ];
}
