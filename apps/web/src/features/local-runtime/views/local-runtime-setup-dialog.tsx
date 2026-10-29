import { t } from '@app/lib/i18n';
import LaptopIcon from '@icon/system/regular/laptop.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel } from '@ui';
import type { JSX } from 'solid-js';

/** Setup in a dialog, for setup started outside Settings. */
export function LocalRuntimeSetupDialog(props: {
  open: boolean;
  onClose: () => void;
  /** The setup panel. */
  children: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => (open ? undefined : props.onClose())}
      position="center"
      class="w-120"
    >
      <Panel depth={2} active class="rounded-xl text-ink">
        <Panel.Header class="gap-2 px-5">
          <span aria-hidden="true" class="text-ink-muted [&_svg]:size-4">
            <LaptopIcon />
          </span>
          <Dialog.Title class="text-sm font-semibold">
            {t('localRuntime.title')}
          </Dialog.Title>
          <div class="ml-auto">
            <Button
              variant="ghost"
              size="icon-sm"
              tooltip={t('localRuntime.close')}
              aria-label={t('localRuntime.close')}
              onClick={() => props.onClose()}
            >
              <XIcon class="size-4" />
            </Button>
          </div>
        </Panel.Header>
        <Panel.Body class="flex flex-col gap-4 p-5">
          <p class="text-sm text-ink-muted">{t('localRuntime.description')}</p>
          {props.children}
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
