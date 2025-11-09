import {
  type EdgeConnectionStyle,
  EdgeConnectionStyles,
} from '@block-canvas/model/CanvasModel';
import { useCachedStyle } from '@block-canvas/signal/cachedStyle';
import { useToolManager } from '@block-canvas/signal/toolManager';
import { IconButton } from '@core/component/IconButton';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  ENABLE_CANVAS_FILES,
  ENABLE_CANVAS_IMAGES,
  ENABLE_CANVAS_TEXT,
} from '@core/constant/featureFlags';
import { IS_MAC } from '@core/constant/isMac';
import { TOKENS } from '@core/hotkey/tokens';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
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
        <IconButton
          icon={SmallCaretDown}
          theme="clear"
          style={{ width: '12px', margin: '0 -2px 0 -4px' }}
          tooltip={null}
          tabIndex={-1}
        />
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
  const canEdit = useCanEdit();
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
          class={`flex flex-row items-center space-x-2 ${canEdit() && 'border-r border-edge'}`}
        >
          <IconButton
            tooltip={{
              label: 'Hand tool',
              hotkeyToken: TOKENS.canvas.handTool,
            }}
            showShortcut={true}
            theme={activeTool() === Tools.Grab ? 'accent' : 'clear'}
            icon={Hand}
            onClick={() => {
              toolManager.setSelectedTool(Tools.Grab);
            }}
          />

          <Show when={!isNativeMobilePlatform()}>
            <IconButton
              tooltip={[
                { label: 'Zoom', hotkeyToken: TOKENS.canvas.zoomInTool },
                {
                  label: 'Zoom out',
                  shortcut: `hold ${IS_MAC ? 'option' : 'alt'}`,
                },
              ]}
              showShortcut={true}
              theme={
                activeTool() === Tools.ZoomIn || activeTool() === Tools.ZoomOut
                  ? 'accent'
                  : 'clear'
              }
              icon={activeTool() === Tools.ZoomOut ? ZoomOut : ZoomIn}
              onClick={() => {
                toolManager.setSelectedTool(Tools.ZoomIn);
              }}
            />
          </Show>

          <Show when={canEdit()}>
            <IconButton
              tooltip={{ label: 'Move', hotkeyToken: TOKENS.canvas.selectTool }}
              showShortcut={true}
              theme={
                activeTool() === Tools.Select ||
                activeTool() === Tools.Resize ||
                activeTool() === Tools.Move
                  ? 'accent'
                  : 'clear'
              }
              icon={Cursor}
              onClick={() => {
                toolManager.setSelectedTool(Tools.Select);
              }}
            />
          </Show>
        </div>
        <Show when={canEdit()}>
          <div class="flex flex-row px-2 items-center space-x-2">
            <IconButton
              tooltip={{
                label: 'Rectangle',
                hotkeyToken: TOKENS.canvas.shapeTool,
              }}
              showShortcut={true}
              theme={activeTool() === Tools.Shape ? 'accent' : 'clear'}
              icon={Rectangle}
              onClick={() => {
                toolManager.setSelectedTool(Tools.Shape);
              }}
            />

            <IconButton
              tooltip={{
                label: 'Pencil',
                hotkeyToken: TOKENS.canvas.pencilTool,
              }}
              showShortcut={true}
              theme={activeTool() === Tools.Pencil ? 'accent' : 'clear'}
              icon={PencilSimple}
              onClick={() => {
                toolManager.setSelectedTool(Tools.Pencil);
              }}
            />

            <IconButton
              tooltip={{
                label: 'Connector',
                hotkeyToken: TOKENS.canvas.lineTool,
              }}
              showShortcut={true}
              theme={activeTool() === Tools.Line ? 'accent' : 'clear'}
              icon={connectorIcon()}
              onClick={() => {
                toolManager.setSelectedTool(Tools.Line);
              }}
            />
            <ConnectorTypeSubMenu onSelect={onSelectConnectionStyle} />

            <Show when={ENABLE_CANVAS_TEXT}>
              <IconButton
                tooltip={{ label: 'Text', hotkeyToken: TOKENS.canvas.textTool }}
                showShortcut={true}
                theme={
                  activeTool() === Tools.Text || activeTool() === Tools.Typing
                    ? 'accent'
                    : 'clear'
                }
                icon={Text}
                onClick={() => {
                  toolManager.setSelectedTool(Tools.Text);
                }}
              />
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
