import { useAlign } from '@block-canvas/signal/align';
import { clamp } from '@block-canvas/util/math';
import { vec2 } from '@block-canvas/util/vector2';
import { IconButton } from '@core/component/IconButton';
import {
  type DropdownPreset,
  SlidableNumberInput,
} from '@core/component/SlidableNumberInput';
import { themeColors, themeStyles } from '@core/component/Themes';
import { Tooltip } from '@core/component/Tooltip';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import AlignBottom from '@phosphor-icons/core/regular/align-bottom.svg?component-solid';
import AlignCenterHorizontal from '@phosphor-icons/core/regular/align-center-horizontal.svg?component-solid';
import AlignCenterVertical from '@phosphor-icons/core/regular/align-center-vertical.svg?component-solid';
import AlignLeft from '@phosphor-icons/core/regular/align-left.svg?component-solid';
import AlignRight from '@phosphor-icons/core/regular/align-right.svg?component-solid';
import AlignTop from '@phosphor-icons/core/regular/align-top.svg?component-solid';
import Reverse from '@phosphor-icons/core/regular/arrows-horizontal.svg?component-solid';
import CornersOut from '@phosphor-icons/core/regular/corners-out.svg?component-solid';
import TextAa from '@phosphor-icons/core/regular/text-aa.svg?component-solid';
import TrashSimple from '@phosphor-icons/core/regular/trash-simple.svg?component-solid';
import type { JSX } from 'solid-js';
import {
  batch,
  type Component,
  createMemo,
  For,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { unwrap } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import type { CanvasEntityStyle, NodeType } from '../model/CanvasModel';
import { useCachedStyle } from '../signal/cachedStyle';
import { useCanvasHistory } from '../signal/canvasHistory';
import { useSelection } from '../signal/selection';
import { useToolManager } from '../signal/toolManager';
import { useCanvasEdges, useCanvasNodes } from '../store/canvasData';
import { allStyleProps, getTailwindColor } from '../util/style';
import { handleDelete } from './CanvasController';
import {
  ArrowCaret,
  ArrowCircle,
  ArrowCircleSmall,
  ArrowLine,
  ArrowTriangle,
  ConnectorBezier,
  ConnectorStepped,
  ConnectorStraight,
} from './icons-custom/ArrowIcons';
import { LineWeight } from './icons-custom/LineWeight';
import { Swatch } from './Swatch';

type CanvasEntity = NodeType | 'edge';
type ColorOption = {
  base: string;
  fill: string;
  stroke: string;
};

function createColorOption(base: string, fillTint: number, strokeTint: number) {
  return {
    base,
    fill: `${base}-${fillTint}`,
    stroke: `${base}-${strokeTint}`,
  };
}

const colorOptions: ColorOption[] = [
  createColorOption('gray', 50, 700),
  createColorOption('neutral', 200, 400),
  createColorOption('red', 200, 600),
  createColorOption('orange', 200, 600),
  createColorOption('amber', 200, 600),
  createColorOption('green', 200, 600),
  createColorOption('blue', 200, 600),
];

const mobileColorOptions: ColorOption[] = [
  createColorOption('gray', 50, 700),
  createColorOption('neutral', 200, 400),
  createColorOption('red', 200, 600),
  createColorOption('amber', 200, 600),
  createColorOption('green', 200, 600),
  createColorOption('blue', 200, 600),
];

const ValidPropsByEntity: Partial<Record<CanvasEntity, Set<string>>> = {
  shape: new Set([
    'fillColor',
    'strokeColor',
    'strokeWidth',
    'cornerRadius',
    'opacity',
    'textSize',
  ]),
  pencil: new Set(['strokeColor', 'strokeWidth', 'opacity']),
  edge: new Set(['strokeColor', 'strokeWidth', 'opacity']),
  text: new Set(['textSize', 'strokeColor']),
  image: new Set(['strokeColor', 'strokeWidth', 'opacity', 'cornerRadius']),
  file: new Set([]),
};

export function SwatchColorPicker(props: {
  fillColor: string | undefined;
  strokeColor: string | undefined;
  onClick: (colorOption: ColorOption) => void;
}) {
  // Create a memo that determines the currently selected variant
  const selectedVariant = createMemo(() => {
    if (!props.fillColor || !props.strokeColor) return undefined;
    return props.fillColor;
  });

  // SCUFFED THEMING TODO: we need to handle canvas color selection? this checks if we are in a darkish or lightish theme but that is janky?
  return (
    <div class={`flex flex-wrap gap-1 ${isMobileWidth() ? 'w-20' : 'w-full'}`}>
      <For each={isMobileWidth() ? mobileColorOptions : colorOptions}>
        {(opt) => (
          <Swatch
            option={opt}
            isSelected={selectedVariant() === getTailwindColor(opt.fill)}
            onClick={props.onClick.bind(null, opt)}
          />
        )}
      </For>
    </div>
  );
}

function GroupLabel(props: { label: string }) {
  return (
    <div class="flex flex-row items-center mb-1">
      <div class="text-[0.67rem] opacity-75">{props.label}</div>
    </div>
  );
}

function Divider() {
  return (
    <Show when={!isMobileWidth()}>
      <div
        class="h-px w-full my-2 -mx-2 bg-edge"
        style={{ width: 'calc(100% + 1rem)' }}
      />
    </Show>
  );
}

function AlignmentOption(props: {
  alignment: number;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  onClick: (alignemnt: number) => void;
}) {
  return (
    <div
      class="size-6 mx-1 flex justify-center items-center rounded-sm hover:bg-hover hover-transition-bg hover:border-1 hover:border-edge"
      onClick={() => {
        props.onClick(props.alignment);
      }}
    >
      <Dynamic
        component={props.icon}
        style={{
          'overflow-clip-margin': 'content-box',
        }}
        width={20}
        height={20}
      />
    </div>
  );
}

function ReverseEdgeButton() {
  const { updateEdge, ...edges } = useCanvasEdges();
  const { selectedEdges } = useSelection();

  return (
    <Tooltip tooltip="Reverse connection">
      <button
        class={`${themeColors['base']} ${themeStyles['base']} h-6 w-6 flex border-0 rounded-md justify-center items-center`}
        onClick={() => {
          edges.batchUpdate(
            () => {
              for (const edge of untrack(selectedEdges)) {
                const { from: oldFrom, to: oldTo } = unwrap(edge);
                updateEdge(edge.id, {
                  to: oldFrom,
                  from: oldTo,
                });
              }
            },
            { autosave: true }
          );
        }}
      >
        <div class="flex justify-start items-center">
          <Dynamic
            component={Reverse}
            style={{
              'overflow-clip-margin': 'content-box',
            }}
            width={15}
            height={15}
          />
        </div>
      </button>
    </Tooltip>
  );
}

function MobileDeleteButton() {
  const toolManager = useToolManager();
  const selection = useSelection();
  const deleteSelection = handleDelete();

  let openMenu!: HTMLDivElement;

  onMount(() => {
    toolManager.ignoreMouseEvents(openMenu);
  });

  return (
    <Show when={selection.active() && isMobileWidth()}>
      <div class="max-h-12 flex p-2 bg-menu cursor-auto justify-center items-center rounded shadow-md ring ring-edge">
        <IconButton
          icon={TrashSimple}
          onClick={deleteSelection}
          class="text-failure"
        />
      </div>
    </Show>
  );
}

const strokeWidthPresets: DropdownPreset[] = [
  {
    value: '0',
    displayName: 'None',
  },
  {
    value: '1',
    displayName: 'Thin',
  },
  {
    value: '2',
    displayName: 'Regular',
  },
  {
    value: '4',
    displayName: 'Thick',
  },
  {
    value: '8',
    displayName: 'Extra thick',
  },
];

const cornerRadiusPresets: DropdownPreset[] = [
  {
    value: '0',
    displayName: 'None',
  },
  {
    value: '4',
    displayName: 'Extra Small',
  },
  {
    value: '8',
    displayName: 'Small',
  },
  {
    value: '16',
    displayName: 'Medium',
  },
  {
    value: '32',
    displayName: 'Larrge',
  },
  {
    value: '64',
    displayName: 'Extra Large',
  },
  {
    value: '100',
    displayName: 'Full',
  },
];

const textSizePresets: DropdownPreset[] = [
  {
    value: '12',
    displayName: 'Extra Small',
  },
  {
    value: '14',
    displayName: 'Small',
  },
  {
    value: '16',
    displayName: 'Base',
  },
  {
    value: '24',
    displayName: 'Large',
  },
  {
    value: '36',
    displayName: 'Extra Large',
  },
];

const arrowStylePresets: DropdownPreset[] = [
  {
    value: '0',
    displayName: 'Line',
    icon: ArrowLine,
  },
  {
    value: '1',
    displayName: 'Arrow',
    icon: ArrowCaret,
  },
  {
    value: '2',
    displayName: 'Arrow Filled',
    icon: ArrowTriangle,
  },
  {
    value: '3',
    displayName: 'Circle',
    icon: ArrowCircle,
  },
  {
    value: '4',
    displayName: 'Dot',
    icon: ArrowCircleSmall,
  },
];

const connectionStylePresets: DropdownPreset[] = [
  {
    value: '0',
    displayName: 'Straight',
    icon: ConnectorStraight,
  },
  {
    value: '1',
    displayName: 'Bent',
    icon: ConnectorStepped,
  },
  {
    value: '2',
    displayName: 'Curved',
    icon: ConnectorBezier,
  },
];

export function FloatingMenu() {
  const { selectedNodes, selectedEdges, extractSharedStyles, ...selection } =
    useSelection();
  const { updateNode, ...nodes } = useCanvasNodes();
  const { updateEdge, ...edges } = useCanvasEdges();
  const history = useCanvasHistory();
  const cachedStyle = useCachedStyle();
  const toolManager = useToolManager();

  let ref!: HTMLDivElement;

  onMount(() => {
    toolManager.ignoreMouseEvents(ref);
  });

  const sharedStyles = createMemo(() => {
    if (!selection.active())
      return new Map(Object.entries(cachedStyle.getStyle()));

    return extractSharedStyles();
  });

  const entityTypesInSelection = createMemo(() => {
    const types = new Set<CanvasEntity>();

    const activeTool = toolManager.activeTool();
    types.add(activeTool.toLowerCase() as CanvasEntity); // Convert to lowercase

    for (const node of selectedNodes()) {
      types.add(node.type);
    }
    if (selectedEdges().length > 0) types.add('edge');
    return types;
  });

  const validMenus = createMemo(() => {
    let menus = new Set(allStyleProps);
    for (const entity of entityTypesInSelection()) {
      if (entity in ValidPropsByEntity) {
        menus = menus.intersection(ValidPropsByEntity[entity]!);
      }
    }
    return menus;
  });

  function applyStyle(style: keyof CanvasEntityStyle, value: any) {
    batch(() => {
      nodes.batchUpdate(
        () => {
          for (const node of untrack(selectedNodes)) {
            const nodeStyle = { ...(unwrap(node).style ?? {}) };
            nodeStyle[style] = value;
            updateNode(node.id, { style: nodeStyle });
          }
        },
        { autosave: true }
      );
      edges.batchUpdate(
        () => {
          for (const edge of untrack(selectedEdges)) {
            const edgeStyle = { ...(unwrap(edge).style ?? {}) };
            edgeStyle[style] = value;
            updateEdge(edge.id, { style: edgeStyle });
          }
        },
        { autosave: true }
      );
    });
  }

  function applyStyleWithHistory(style: keyof CanvasEntityStyle, value: any) {
    cachedStyle.setProp(style, value);
    if (!selection.active()) return;
    history.open();
    applyStyle(style, value);
    history.close();
  }

  function applyUnfiedColor(colorOption: ColorOption) {
    const { stroke, fill } = colorOption;
    const strokeColor = getTailwindColor(stroke);
    const fillColor = getTailwindColor(fill);
    cachedStyle.setProp('strokeColor', strokeColor);
    cachedStyle.setProp('fillColor', fillColor);
    if (!selection.active()) return;
    history.open();
    batch(() => {
      if (fill) applyStyle('fillColor', fillColor);
      if (stroke) applyStyle('strokeColor', strokeColor);
      applyStyle('importedColor', false);
    });
    history.close();
  }

  //if the only thing in the menu is alignment
  const alignmentOnly = createMemo(() => {
    const nodes = selectedNodes();
    const edges = selectedEdges();
    const nodesLength = nodes.length;
    if (
      nodesLength > 1 &&
      nodes.some((node) => node.type === 'file') &&
      edges.length < 1
    ) {
      return true;
    }
    return false;
  });

  const { align } = useAlign();

  return (
    <div
      class={`absolute flex flex-row top-4 z-5 cursor-auto ${!isMobileWidth() && 'right-4'}`}
    >
      <div
        class={`flex
          ${isMobileWidth() ? 'flex-row p-2 mr-2' : 'flex-col w-54 p-3'}
          bg-menu rounded-lg shadow-lg ring ring-edge
          ${selectedNodes().length + selectedEdges().length <= 1 && validMenus().size === 0 && 'hidden'}`}
        ref={ref}
        oncontextmenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <Show when={validMenus().has('strokeColor')}>
          <div
            class={`flex justify-center items-center ${isMobileWidth() && (validMenus().has('strokeWidth') || validMenus().has('textSize') || selectedNodes().length + selectedEdges().length > 1) && 'mr-4'}`}
          >
            <SwatchColorPicker
              onClick={(color) => applyUnfiedColor(color)}
              fillColor={sharedStyles().get('fillColor')}
              strokeColor={sharedStyles().get('strokeColor')}
            />
          </div>
        </Show>

        <div class={`flex w-full grow flex-col`}>
          <Show
            when={
              !isMobileWidth() &&
              (validMenus().has('endStyle') || selectedEdges().length > 0)
            }
          >
            <Show when={validMenus().has('strokeColor')}>
              <Divider />
            </Show>
            <div class="flex flex-row h-10 justify-between items-center">
              <GroupLabel label="Line Styles" />
              <ReverseEdgeButton />
            </div>
            <div class="flex flex-row justify-between">
              <SlidableNumberInput
                icon={
                  sharedStyles().get('fromEndStyle')
                    ? arrowStylePresets[sharedStyles().get('fromEndStyle')]
                        .icon!
                    : arrowStylePresets[0].icon!
                }
                inputChanged={(newValue: string) => {
                  const parsedValue = Number.parseInt(newValue);
                  applyStyleWithHistory('fromEndStyle', parsedValue);
                }}
                currentValue={
                  sharedStyles().get('fromEndStyle')
                    ? arrowStylePresets[sharedStyles().get('fromEndStyle')]
                        .value!
                    : arrowStylePresets[0].value!
                }
                width="sm"
                presets={arrowStylePresets}
                showPresets={true}
                fullIcon={true}
                tooltip="Line start"
              />
              <SlidableNumberInput
                icon={
                  sharedStyles().get('connectionStyle')
                    ? connectionStylePresets[
                        sharedStyles().get('connectionStyle')
                      ].icon!
                    : connectionStylePresets[0].icon!
                }
                inputChanged={(newValue: string) => {
                  const parsedValue = Number.parseInt(newValue);
                  applyStyleWithHistory('connectionStyle', parsedValue);
                }}
                currentValue={
                  sharedStyles().get('connectionStyle')
                    ? connectionStylePresets[
                        sharedStyles().get('connectionStyle')
                      ].value!
                    : connectionStylePresets[0].value!
                }
                width="sm"
                presets={connectionStylePresets}
                showPresets={true}
                hideValue={true}
                fullIcon={true}
                tooltip="Connection type"
              />
              <SlidableNumberInput
                icon={
                  sharedStyles().get('toEndStyle')
                    ? arrowStylePresets[sharedStyles().get('toEndStyle')].icon!
                    : arrowStylePresets[0].icon!
                }
                inputChanged={(newValue: string) => {
                  const parsedValue = Number.parseInt(newValue);
                  applyStyleWithHistory('toEndStyle', parsedValue);
                }}
                currentValue={
                  sharedStyles().get('toEndStyle')
                    ? arrowStylePresets[sharedStyles().get('toEndStyle')].value!
                    : arrowStylePresets[0].value!
                }
                width="sm"
                presets={arrowStylePresets}
                showPresets={true}
                hideValue={true}
                fullIcon={true}
                flip={true}
                tooltip="Line end"
              />
            </div>
          </Show>
          <Show when={selectedNodes().length + selectedEdges().length > 1}>
            <Show when={!alignmentOnly()}>
              <Divider />
            </Show>
            <GroupLabel label="Align objects" />
            <div class="flex flex-wrap justify-center">
              <AlignmentOption
                alignment={0}
                icon={AlignLeft}
                onClick={(alignment) => {
                  align(alignment, true);
                }}
              />
              <AlignmentOption
                alignment={1}
                icon={AlignCenterHorizontal}
                onClick={(alignment) => {
                  align(alignment, true);
                }}
              />
              <AlignmentOption
                alignment={2}
                icon={AlignRight}
                onClick={(alignment) => {
                  align(alignment, true);
                }}
              />
              <AlignmentOption
                alignment={3}
                icon={AlignTop}
                onClick={(alignment) => {
                  align(alignment, true);
                }}
              />
              <AlignmentOption
                alignment={4}
                icon={AlignCenterVertical}
                onClick={(alignment) => {
                  align(alignment, true);
                }}
              />
              <AlignmentOption
                alignment={5}
                icon={AlignBottom}
                onClick={(alignment) => {
                  align(alignment, true);
                }}
              />
            </div>
          </Show>
          <Show
            when={
              validMenus().has('strokeWidth') ||
              validMenus().has('cornerRadius')
            }
          >
            <Divider />
          </Show>
          <div
            class={`flex ${isMobileWidth() ? 'flex-row' : 'flex-col'} ${isMobileWidth() && selectedNodes().length + selectedEdges().length > 1 && 'hidden'}`}
          >
            <div class="flex flex-row">
              <Show when={validMenus().has('strokeWidth')}>
                <div class={`${!isMobileWidth() && 'mr-3.5'}`}>
                  <SlidableNumberInput
                    label={'Line weight'}
                    labelPosition="top"
                    icon={LineWeight}
                    inputChanged={(newValue: string) => {
                      const parsedValue = Number.parseInt(newValue);
                      if (Number.isNaN(parsedValue)) return;
                      applyStyleWithHistory(
                        'strokeWidth',
                        clamp(parsedValue, 0, 8)
                      );
                    }}
                    onSlideStart={() => {
                      if (!selection.active()) return;
                      history.open();
                    }}
                    onSlidePreview={(newValue) => {
                      if (!selection.active()) return;
                      if (!newValue) return;
                      applyStyle(
                        'strokeWidth',
                        clamp(Number.parseInt(newValue), 0, 8)
                      );
                    }}
                    onSlideEnd={(newValue) => {
                      if (!selection.active()) return;
                      if (!newValue) return;
                      applyStyle(
                        'strokeWidth',
                        clamp(Number.parseInt(newValue), 0, 8)
                      );
                      history.close();
                    }}
                    currentValue={sharedStyles().get('strokeWidth') ?? '-'}
                    range={vec2(0, 8)}
                    width={
                      !isMobileWidth() && !validMenus().has('cornerRadius')
                        ? 'lg'
                        : 'sm'
                    }
                    presets={strokeWidthPresets}
                    showPresets={true}
                    isSlidable={true}
                  />
                </div>
              </Show>
              <Show when={!isMobileWidth() && validMenus().has('cornerRadius')}>
                <SlidableNumberInput
                  label={'Corner rounding'}
                  labelPosition="top"
                  icon={CornersOut}
                  inputChanged={(newValue: string) => {
                    const parsedValue = Number.parseInt(newValue);
                    if (Number.isNaN(parsedValue)) return;
                    applyStyleWithHistory(
                      'cornerRadius',
                      clamp(parsedValue, 0, 100)
                    );
                  }}
                  onSlideStart={() => {
                    if (!selection.active()) return;
                    history.open();
                  }}
                  onSlidePreview={(newValue) => {
                    if (!selection.active()) return;
                    if (!newValue) return;
                    applyStyle(
                      'cornerRadius',
                      clamp(Number.parseInt(newValue), 0, 100)
                    );
                  }}
                  onSlideEnd={(newValue) => {
                    if (!selection.active()) return;
                    if (!newValue) return;
                    applyStyle(
                      'cornerRadius',
                      clamp(Number.parseInt(newValue), 0, 100)
                    );
                    history.close();
                  }}
                  currentValue={sharedStyles().get('cornerRadius') ?? '-'}
                  range={vec2(0, 100)}
                  width="sm"
                  presets={cornerRadiusPresets}
                  showPresets={true}
                  isSlidable={true}
                />
              </Show>
            </div>
            <Show when={validMenus().has('textSize')}>
              <Divider />
              <div
                class={`${isMobileWidth() && (validMenus().has('strokeWidth') || validMenus().has('cornerRadius')) && 'ml-2'}`}
              >
                <SlidableNumberInput
                  label={'Font size'}
                  labelPosition="top"
                  icon={TextAa}
                  onSlideStart={() => {
                    if (!selection.active()) return;
                    history.open();
                  }}
                  inputChanged={(newValue: string) => {
                    const parsedValue = Number.parseInt(newValue);
                    if (Number.isNaN(parsedValue)) return;
                    applyStyleWithHistory(
                      'textSize',
                      clamp(parsedValue, 5, 72)
                    );
                  }}
                  onSlidePreview={(newValue) => {
                    if (!selection.active()) return;
                    if (!newValue) return;
                    applyStyle(
                      'textSize',
                      clamp(Number.parseInt(newValue), 5, 72)
                    );
                  }}
                  onSlideEnd={(newValue) => {
                    if (!selection.active()) return;
                    if (!newValue) return;
                    applyStyle(
                      'textSize',
                      clamp(Number.parseInt(newValue), 5, 72)
                    );
                    history.close();
                  }}
                  currentValue={sharedStyles().get('textSize') ?? '-'}
                  range={vec2(5, 72)}
                  width={isMobileWidth() ? 'sm' : 'lg'}
                  presets={textSizePresets}
                  showPresets={true}
                  isSlidable={true}
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
      <MobileDeleteButton />
    </div>
  );
}
