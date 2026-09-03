import { Button, Dialog, Panel } from '@ui';

export type DisconnectConfirm = {
  title: string;
  body: string;
  onConfirm: () => void;
};

export function DisconnectConfirmDialog(props: {
  request: DisconnectConfirm | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={props.request !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      visibleScrim
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <Dialog.Title class="text-ink text-sm font-semibold">
            {props.request?.title ?? 'Disconnect from Macro'}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="p-6 font-sans flex flex-col gap-3">
          <Dialog.Description class="text-ink-muted text-sm/tight font-normal">
            {props.request?.body}
          </Dialog.Description>
          <div class="pt-3 justify-end items-center gap-3 inline-flex">
            <Button variant="outline" depth={3} onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              depth={3}
              onClick={() => {
                const request = props.request;
                if (!request) return;
                props.onClose();
                request.onConfirm();
              }}
            >
              Disconnect
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
