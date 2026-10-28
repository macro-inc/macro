import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { FileDownloadController } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import ShareIcon from '@icon/share.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, ButtonGroup, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useHoldParentHoverCardOpen } from './HoverCard';

export function FileDownloadButton(props: {
  download: FileDownloadController;
  iconOnly?: boolean;
  grouped?: boolean;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  useHoldParentHoverCardOpen(() => menuOpen() || props.download.busy());
  const preparing = () => {
    const { loaded, total } = props.download.progress();
    return total > 0
      ? `Preparing ${Math.min(100, Math.round((loaded / total) * 100))}%`
      : 'Preparing…';
  };
  const saveLabel = () =>
    props.download.phase() === 'error'
      ? 'Retry download'
      : props.download.phase() === 'ready' && props.download.action() === 'save'
        ? 'Save file'
        : 'Download';
  const label = () => (props.download.busy() ? preparing() : saveLabel());
  const start = async (action: 'save' | 'share' = 'save') => {
    await props.download.start(action);
    if (props.download.phase() === 'idle') setMenuOpen(false);
  };
  const save = () => fireAndForget(start(), 'file-download');
  const buttonSize = () => {
    if (props.iconOnly) return props.grouped ? 'icon-sm' : 'icon-md';
    return props.grouped ? undefined : 'md';
  };
  const icon = () => (
    <Show
      when={props.download.busy()}
      fallback={<DownloadIcon class="size-4 shrink-0 touch:size-6" />}
    >
      <SpinnerIcon class="size-4 shrink-0 animate-spin touch:size-6" />
    </Show>
  );

  return (
    <Show
      when={isTouchDevice() && props.download.canOfferShare()}
      fallback={
        <>
          <Dynamic
            component={props.grouped ? ButtonGroup.Button : Button}
            variant="ghost"
            size={buttonSize()}
            aria-label={label()}
            tooltip={label()}
            disabled={props.download.busy()}
            onClick={save}
          >
            {icon()}
            <Show when={!props.iconOnly}>{label()}</Show>
          </Dynamic>
          <Show when={props.download.busy()}>
            <Dynamic
              component={props.grouped ? ButtonGroup.Button : Button}
              variant="ghost"
              size={buttonSize()}
              aria-label="Cancel download"
              tooltip="Cancel download"
              onClick={props.download.cancel}
            >
              <Show when={props.iconOnly} fallback="Cancel">
                <XIcon class="size-4 shrink-0 touch:size-6" />
              </Show>
            </Dynamic>
          </Show>
        </>
      }
    >
      <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
        <Dropdown.Trigger
          as={props.grouped ? ButtonGroup.Button : Button}
          variant="ghost"
          size={buttonSize()}
          aria-label={label()}
          tooltip={label()}
        >
          {icon()}
          <Show when={!props.iconOnly}>{label()}</Show>
        </Dropdown.Trigger>
        <Dropdown.Content blockingBackdrop>
          <Dropdown.Item
            class="touch:min-h-11"
            closeOnSelect={false}
            disabled={props.download.busy()}
            onSelect={save}
          >
            <DownloadIcon class="size-4" />
            {props.download.busy() && props.download.action() === 'save'
              ? preparing()
              : saveLabel()}
          </Dropdown.Item>
          <Dropdown.Item
            class="touch:min-h-11"
            closeOnSelect={false}
            disabled={props.download.busy()}
            onSelect={() => fireAndForget(start('share'), 'file-download')}
          >
            <ShareIcon class="size-4" />
            {props.download.busy() && props.download.action() === 'share'
              ? preparing()
              : 'Share'}
          </Dropdown.Item>
          <Show when={props.download.busy()}>
            <Dropdown.Item
              class="touch:min-h-11"
              onSelect={props.download.cancel}
            >
              Cancel
            </Dropdown.Item>
          </Show>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
