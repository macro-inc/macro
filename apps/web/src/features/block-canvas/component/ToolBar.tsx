import {
  type EdgeConnectionStyle,
  EdgeConnectionStyles,
} from '@block-canvas/model/CanvasModel';
import { useCachedStyle } from '@block-canvas/signal/cachedStyle';
import { useToolManager } from '@block-canvas/signal/toolManager';
import { useIsNestedBlock } from '@core/block';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  ENABLE_CANVAS_FILES,
  ENABLE_CANVAS_IMAGES,
  ENABLE_CANVAS_TEXT,
} from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { useCanEdit } from '@core/signal/permissions';
import CaretDown from '@phosphor/caret-down.svg';
import Cursor from '@phosphor/cursor.svg';
import Hand from '@phosphor/hand.svg';
import ZoomOut from '@phosphor/magnifying-glass-minus.svg';
import ZoomIn from '@phosphor/magnifying-glass-plus.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Rectangle from '@phosphor/rectangle.svg';
import Text from '@phosphor/text-t.svg';
import { Button, ButtonGroup, Dropdown, Hotkey, Toolbar } from '@ui';
import { createSignal, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Tools } from '../constants';
import { FileSelector } from './FileSelector';
import {
  ConnectorBezierArrows,
  ConnectorSteppedArrows,
  ConnectorStraightArrows,
} from './icons-custom/ArrowIcons';
import { MediaSelector } from './MediaSelector';
import { connectorTypeMenuTriggerSignal } from './TopBar';

const ConnectorTypeSubMenu = (props: {
  onSelect: (connectionStye: EdgeConnectionStyle) => void;
}) => {
  const [connectorTypeMenuTrigger, setConnectorTypeMenuTrigger] =
    connectorTypeMenuTriggerSignal;

  return (
    <Dropdown
      placement="bottom"
      open={connectorTypeMenuTrigger()}
      onOpenChange={setConnectorTypeMenuTrigger}
    >
      <Dropdown.Trigger size="icon-sm" label="Connector options" tabIndex={-1}>
        <CaretDown class="size-3 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <Dropdown.Item
            onSelect={() => {
              props.onSelect('straight');
            }}
          >
            <ConnectorStraightArrows class="size-4 shrink-0" />
            <span class="flex-1 truncate">Connector</span>
            <Hotkey
              token={TOKENS.canvas.line.straight}
              class="text-ink-muted"
              showPlus
            />
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => {
              props.onSelect('smooth');
            }}
          >
            <ConnectorBezierArrows class="size-4 shrink-0" />
            <span class="flex-1 truncate">Flow Connector</span>
            <Hotkey
              token={TOKENS.canvas.line.flow}
              class="text-ink-muted"
              showPlus
            />
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => {
              props.onSelect('stepped');
            }}
          >
            <ConnectorSteppedArrows class="size-4 shrink-0" />
            <span class="flex-1 truncate">Bent Connector</span>
            <Hotkey
              token={TOKENS.canvas.line.bent}
              class="text-ink-muted"
              showPlus
            />
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};

export function ToolBar() {
  const baseCanEdit = useCanEdit();
  const isNested = useIsNestedBlock();
  const canEdit = () => baseCanEdit() && !isNested;
  const toolManager = useToolManager();
  const cachedStyle = useCachedStyle();
  const { activeTool } = toolManager;
  const [connectorTypeMenuTrigger, setConnectorTypeMenuTrigger] =
    connectorTypeMenuTriggerSignal;
  const scopeId = blockHotkeyScopeSignal.get;

  const [connectionStyle, setConnectionStyle] =
    createSignal<EdgeConnectionStyle>('straight');

  const onSelectConnectionStyle = (connectionStyle: EdgeConnectionStyle) => {
    setConnectionStyle(connectionStyle);
    cachedStyle.setProp(
      'connectionStyle',
      EdgeConnectionStyles[connectionStyle]
    );
    toolManager.setSelectedTool(Tools.Line);
  };

  const connectorIcon = () => {
    switch (connectionStyle()) {
      case 'smooth':
        return ConnectorBezierArrows;
      case 'stepped':
        return ConnectorSteppedArrows;
      default:
        return ConnectorStraightArrows;
    }
  };

  registerHotkey({
    hotkey: 's',
    scopeId: scopeId(),
    condition: () => connectorTypeMenuTrigger(),
    description: 'Straight connector',
    keyDownHandler: () => {
      onSelectConnectionStyle('straight');
      setConnectorTypeMenuTrigger(false);
      return true;
    },
    hotkeyToken: TOKENS.canvas.line.straight,
  });
  registerHotkey({
    hotkey: 'f',
    scopeId: scopeId(),
    condition: () => connectorTypeMenuTrigger(),
    description: 'Flow connector',
    keyDownHandler: () => {
      onSelectConnectionStyle('smooth');
      setConnectorTypeMenuTrigger(false);
      return true;
    },
    hotkeyToken: TOKENS.canvas.line.flow,
  });
  registerHotkey({
    hotkey: 'b',
    scopeId: scopeId(),
    condition: () => connectorTypeMenuTrigger(),
    description: 'Bent connector',
    keyDownHandler: () => {
      onSelectConnectionStyle('stepped');
      setConnectorTypeMenuTrigger(false);
      return true;
    },
    hotkeyToken: TOKENS.canvas.line.bent,
  });

  return (
    <ScopedPortal scope="block">
      {/* Full-frame mobile/tablet: rest above the floating bottom chrome. */}
      <Toolbar
        size="icon-sm"
        class="absolute left-1/2 bottom-2 touch:bottom-[calc(var(--mobile-content-inset-bottom,0)+0.5rem)] -translate-x-1/2"
      >
        <Toolbar.Group>
          <Toolbar.Button
            variant={activeTool() === Tools.Grab ? 'accent' : 'ghost'}
            label="Hand tool"
            hotkey={TOKENS.canvas.handTool}
            onClick={() => {
              toolManager.setSelectedTool(Tools.Grab);
            }}
          >
            <Hand />
          </Toolbar.Button>

          <Show when={!isTouchDevice()}>
            <Toolbar.Button
              variant={
                activeTool() === Tools.ZoomIn || activeTool() === Tools.ZoomOut
                  ? 'accent'
                  : 'ghost'
              }
              label="Zoom"
              hotkey={TOKENS.canvas.zoomInTool}
              /* scuffed: previously also showed a second row
                 "Zoom out — hold ${IS_MAC ? 'option' : 'alt'}"
                 but multi-row tooltips were dropped. */
              onClick={() => {
                toolManager.setSelectedTool(Tools.ZoomIn);
              }}
            >
              {activeTool() === Tools.ZoomOut ? <ZoomOut /> : <ZoomIn />}
            </Toolbar.Button>
          </Show>

          <Show when={canEdit()}>
            <Toolbar.Button
              variant={
                activeTool() === Tools.Select ||
                activeTool() === Tools.Resize ||
                activeTool() === Tools.Move
                  ? 'accent'
                  : 'ghost'
              }
              label="Move"
              hotkey={TOKENS.canvas.selectTool}
              onClick={() => {
                toolManager.setSelectedTool(Tools.Select);
              }}
            >
              <Cursor />
            </Toolbar.Button>
          </Show>
        </Toolbar.Group>
        <Show when={canEdit()}>
          <Toolbar.Divider />
          <Toolbar.Group>
            <Toolbar.Button
              variant={activeTool() === Tools.Shape ? 'accent' : 'ghost'}
              label="Rectangle"
              hotkey={TOKENS.canvas.shapeTool}
              onClick={() => {
                toolManager.setSelectedTool(Tools.Shape);
              }}
            >
              <Rectangle />
            </Toolbar.Button>

            <Toolbar.Button
              variant={activeTool() === Tools.Pencil ? 'accent' : 'ghost'}
              label="Pencil"
              hotkey={TOKENS.canvas.pencilTool}
              onClick={() => {
                toolManager.setSelectedTool(Tools.Pencil);
              }}
            >
              <PencilSimple />
            </Toolbar.Button>

            <ButtonGroup variant="outline" size="icon-sm">
              <Button
                variant={activeTool() === Tools.Line ? 'accent' : 'outline'}
                label="Connector"
                hotkey={TOKENS.canvas.lineTool}
                onClick={() => {
                  toolManager.setSelectedTool(Tools.Line);
                }}
              >
                <Dynamic component={connectorIcon()} />
              </Button>
              <ButtonGroup.Divider />
              <ConnectorTypeSubMenu onSelect={onSelectConnectionStyle} />
            </ButtonGroup>

            <Show when={ENABLE_CANVAS_TEXT}>
              <Toolbar.Button
                variant={
                  activeTool() === Tools.Text || activeTool() === Tools.Typing
                    ? 'accent'
                    : 'ghost'
                }
                label="Text"
                hotkey={TOKENS.canvas.textTool}
                onClick={() => {
                  toolManager.setSelectedTool(Tools.Text);
                }}
              >
                <Text />
              </Toolbar.Button>
            </Show>
          </Toolbar.Group>
        </Show>
        <Show when={canEdit() && (ENABLE_CANVAS_IMAGES || ENABLE_CANVAS_FILES)}>
          <Toolbar.Divider />
          <Toolbar.Group>
            <Show when={ENABLE_CANVAS_IMAGES}>
              <MediaSelector />
            </Show>
            <Show when={ENABLE_CANVAS_FILES}>
              <FileSelector />
            </Show>
          </Toolbar.Group>
        </Show>
      </Toolbar>
    </ScopedPortal>
  );
}
