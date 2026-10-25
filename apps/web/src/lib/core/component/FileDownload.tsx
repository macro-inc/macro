import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { FileDownloadController } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import DownloadIcon from '@phosphor/download-simple.svg';
import ShareIcon from '@phosphor/export.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useHoldParentHoverCardOpen } from './HoverCard';

export function FileDownloadButton(props: {
  download: FileDownloadController;
  iconOnly?: boolean;
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
  const icon = () => (
    <Show when={props.download.busy()} fallback={<DownloadIcon />}>
      <SpinnerIcon class="animate-spin" />
    </Show>
  );

  return (
    <Show
      when={isTouchDevice() && props.download.canOfferShare()}
      fallback={
        <>
          <Button
            variant="ghost"
            size={props.iconOnly ? 'icon-md' : 'md'}
            label={label()}
            disabled={props.download.busy()}
            onClick={save}
          >
            {icon()}
            <Show when={!props.iconOnly}>{label()}</Show>
          </Button>
          <Show when={props.download.busy()}>
            <Button
              variant="ghost"
              size={props.iconOnly ? 'icon-md' : 'md'}
              label="Cancel download"
              onClick={props.download.cancel}
            >
              <Show when={props.iconOnly} fallback="Cancel">
                <XIcon />
              </Show>
            </Button>
          </Show>
        </>
      }
    >
      <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
        <Dropdown.Trigger
          variant="ghost"
          size={props.iconOnly ? 'icon-md' : 'md'}
          label={label()}
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
