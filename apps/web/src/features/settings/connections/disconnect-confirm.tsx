import { ConfirmDialog } from '@ui';

export type DisconnectConfirm = {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
};

export function DisconnectConfirmDialog(props: {
  request: DisconnectConfirm | null;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={props.request !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={props.request?.title ?? 'Disconnect from Macro'}
      body={props.request?.body}
      confirmLabel={props.request?.confirmLabel ?? 'Disconnect'}
      tone="danger"
      onConfirm={() => {
        const request = props.request;
        if (!request) return;
        props.onClose();
        request.onConfirm();
      }}
    />
  );
}
