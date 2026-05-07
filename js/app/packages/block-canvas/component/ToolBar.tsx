import {
  type EdgeConnectionStyle,
  EdgeConnectionStyles,
} from '@block-canvas/model/CanvasModel';
import { cn } from '@ui';
import { useCachedStyle } from '@block-canvas/signal/cachedStyle';
import { useToolManager } from '@block-canvas/signal/toolManager';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { Button } from '@ui';
import {
  ENABLE_CANVAS_FILES,
  ENABLE_CANVAS_IMAGES,
  ENABLE_CANVAS_TEXT,
} from '@core/constant/featureFlags';
import { IS_MAC } from '@core/constant/isMac';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useIsNestedBlock } from '@core/block';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { useCanEdit } from '@core/signal/permissions';
import CaretDown from '@icon/bold/caret-down-bold.svg';
import Cursor from '@icon/regular/cursor.svg';
import Hand from '@icon/regular/hand.svg';
import ZoomOut from '@icon/regular/magnifying-glass-minus.svg';
import ZoomIn from '@icon/regular/magnifying-glass-plus.svg';
import PencilSimple from '@icon/regular/pencil-simple.svg';
import Rectangle from '@icon/regular/rectangle.svg';
import Text from '@icon/regular/text-t.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { registerHotkey } from 'core/hotkey/hotkeys';
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
  const SmallCaretDown = () => (
    <CaretDown style={{ width: '12px' }} class="text-ink-muted" />
  );
  const [connectorTypeMenuTrigger, setConnectorTypeMenuTrigger] =
    connectorTypeMenuTriggerSignal;

  return (
    <DropdownMenu
      placement="bottom"
      open={connectorTypeMenuTrigger()}
      onOpenChange={setConnectorTypeMenuTrigger}
    >
      <DropdownMenu.Trigger>
        <Button
          variant="ghost"
          size="icon-md"
          style={{ width: '12px', margin: '0 -2px 0 -4px' }}
          tabIndex={-1}
        >
          <SmallCaretDown />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenuContent>
        <MenuItem
          text="Connector"
          icon={ConnectorStraightArrows}
          onClick={() => {
            props.onSelect('straight');
          }}
          hotkeyToken={TOKENS.canvas.line.straight}
        />
        <MenuItem
          text="Flow Connector"
          icon={ConnectorBezierArrows}
          onClick={() => {
            props.onSelect('smooth');
          }}
          hotkeyToken={TOKENS.canvas.line.flow}
        />
        <MenuItem
          text="Bent Connector"
          icon={ConnectorSteppedArrows}
          onClick={() => {
            props.onSelect('stepped');
          }}
          hotkeyToken={TOKENS.canvas.line.bent}
        />
      </DropdownMenuContent>
    </DropdownMenu>
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
      <div class="absolute left-1/2 bottom-2 flex flex-row p-1 bg-menu border border-edge -translate-x-1/2">
        <div
          class={cn(
            'flex flex-row items-center space-x-2',
            canEdit() && 'border-r border-edge'
          )}
        >
          <Button
            variant={activeTool() === Tools.Grab ? 'active' : 'ghost'}
            size="icon-md"
            tooltip={
              <LabelAndHotKey
                label="Hand tool"
                hotkeyToken={TOKENS.canvas.handTool}
              />
            }
            onClick={() => {
              toolManager.setSelectedTool(Tools.Grab);
            }}
          >
            <Hand />
          </Button>

          <Show when={!isTouchDevice()}>
            <Button
              variant={
                activeTool() === Tools.ZoomIn || activeTool() === Tools.ZoomOut
                  ? 'active'
                  : 'ghost'
              }
              size="icon-md"
              tooltip={
                <>
                  <LabelAndHotKey
                    label="Zoom"
                    hotkeyToken={TOKENS.canvas.zoomInTool}
                  />
                  <LabelAndHotKey
                    label="Zoom out"
                    shortcut={`hold ${IS_MAC ? 'option' : 'alt'}`}
                  />
                </>
              }
              onClick={() => {
                toolManager.setSelectedTool(Tools.ZoomIn);
              }}
            >
              {activeTool() === Tools.ZoomOut ? <ZoomOut /> : <ZoomIn />}
            </Button>
          </Show>

          <Show when={canEdit()}>
            <Button
              variant={
                activeTool() === Tools.Select ||
                activeTool() === Tools.Resize ||
                activeTool() === Tools.Move
                  ? 'active'
                  : 'ghost'
              }
              size="icon-md"
              tooltip={
                <LabelAndHotKey
                  label="Move"
                  hotkeyToken={TOKENS.canvas.selectTool}
                />
              }
              onClick={() => {
                toolManager.setSelectedTool(Tools.Select);
              }}
            >
              <Cursor />
            </Button>
          </Show>
        </div>
        <Show when={canEdit()}>
          <div class="flex flex-row px-2 items-center space-x-2">
            <Button
              variant={activeTool() === Tools.Shape ? 'active' : 'ghost'}
              size="icon-md"
              tooltip={
                <LabelAndHotKey
                  label="Rectangle"
                  hotkeyToken={TOKENS.canvas.shapeTool}
                />
              }
              onClick={() => {
                toolManager.setSelectedTool(Tools.Shape);
              }}
            >
              <Rectangle />
            </Button>

            <Button
              variant={activeTool() === Tools.Pencil ? 'active' : 'ghost'}
              size="icon-md"
              tooltip={
                <LabelAndHotKey
                  label="Pencil"
                  hotkeyToken={TOKENS.canvas.pencilTool}
                />
              }
              onClick={() => {
                toolManager.setSelectedTool(Tools.Pencil);
              }}
            >
              <PencilSimple />
            </Button>

            <Button
              variant={activeTool() === Tools.Line ? 'active' : 'ghost'}
              size="icon-md"
              tooltip={
                <LabelAndHotKey
                  label="Connector"
                  hotkeyToken={TOKENS.canvas.lineTool}
                />
              }
              onClick={() => {
                toolManager.setSelectedTool(Tools.Line);
              }}
            >
              <Dynamic component={connectorIcon()} />
            </Button>
            <ConnectorTypeSubMenu onSelect={onSelectConnectionStyle} />

            <Show when={ENABLE_CANVAS_TEXT}>
              <Button
                variant={
                  activeTool() === Tools.Text || activeTool() === Tools.Typing
                    ? 'active'
                    : 'ghost'
                }
                size="icon-md"
                tooltip={
                  <LabelAndHotKey
                    label="Text"
                    hotkeyToken={TOKENS.canvas.textTool}
                  />
                }
                onClick={() => {
                  toolManager.setSelectedTool(Tools.Text);
                }}
              >
                <Text />
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={canEdit()}>
          <div class="flex flex-row px-2 items-center space-x-2 border-l border-edge">
            <Show when={ENABLE_CANVAS_IMAGES}>
              <MediaSelector />
            </Show>
            <Show when={ENABLE_CANVAS_FILES}>
              <FileSelector />
            </Show>
          </div>
        </Show>
      </div>
    </ScopedPortal>
  );
}
