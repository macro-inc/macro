import { ActionDialogShell, Button, Dialog, RadioGroup } from '@ui';
import { For, type JSX, Show } from 'solid-js';

export type RecurringEventScopeOption<Scope extends string> = {
  scope: Scope;
  label: string;
};

export function RecurringEventScopeDialog<Scope extends string>(props: {
  open: boolean;
  title: string;
  options: readonly RecurringEventScopeOption<NoInfer<Scope>>[];
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  description?: string;
  scopeLabel?: string;
  pending?: boolean;
  children?: JSX.Element;
}) {
  const onScopeChange = (value: string) => {
    if (props.pending) return;
    const option = props.options.find((option) => option.scope === value);
    if (option) props.onScopeChange(option.scope);
  };
  const onConfirm = () => {
    if (!props.pending) props.onConfirm();
  };

  return (
    <Dialog
      class="w-110"
      position="center"
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <ActionDialogShell hideBorder>
        <ActionDialogShell.Body class="space-y-5 p-6">
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>{props.title}</ActionDialogShell.Title>
            <Show when={props.description}>
              <ActionDialogShell.Description class="leading-6">
                {props.description}
              </ActionDialogShell.Description>
            </Show>
          </ActionDialogShell.Header>
          <RadioGroup
            value={props.scope}
            disabled={props.pending}
            onChange={onScopeChange}
            aria-label={props.scopeLabel ?? 'Apply changes to'}
            class="gap-2 text-sm text-ink"
          >
            <For each={props.options}>
              {(option) => (
                <RadioGroup.Item
                  value={option.scope}
                  class="min-h-10 gap-3 touch:min-h-11"
                >
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel class="flex-1 py-2 leading-6">
                    {option.label}
                  </RadioGroup.ItemLabel>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>
          <Show when={props.children}>
            {(content) => (
              <div class="space-y-3 text-sm leading-6 text-ink-muted">
                {content()}
              </div>
            )}
          </Show>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer class="border-0 px-6 pt-0 pb-6">
          <Button variant="ghost" size="lg" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={props.pending}
            onClick={onConfirm}
          >
            {props.confirmLabel}
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
