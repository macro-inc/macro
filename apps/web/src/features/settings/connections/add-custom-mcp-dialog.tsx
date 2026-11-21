import { toast } from '@core/component/Toast/Toast';
import { useAddMcpServerMutation } from '@queries/mcp-servers';
import { Button, Dialog, Panel } from '@ui';
import { createSignal } from 'solid-js';

export function AddCustomMcpDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: () => void;
  /** Filled in when the dialog opens, e.g. from an agent's connect card. */
  initialName?: string;
  initialUrl?: string;
  /** Replaces "Add MCP Server", e.g. to name the host a card asks to add. */
  title?: string;
}) {
  const [name, setName] = createSignal(props.initialName ?? '');
  const [url, setUrl] = createSignal(props.initialUrl ?? '');
  const addMutation = useAddMcpServerMutation();

  const reset = () => {
    setName(props.initialName ?? '');
    setUrl(props.initialUrl ?? '');
  };

  const close = () => {
    reset();
    props.onOpenChange(false);
  };

  const handleSubmit = () => {
    if (addMutation.isPending) return;
    const n = name().trim();
    const u = url().trim();
    if (!n || !u) return;

    addMutation.mutate(
      { server_name: n, url: u },
      {
        onSuccess: () => {
          close();
          props.onAdded?.();
        },
        onError: () => {
          toast.failure('Failed to add server');
        },
      }
    );
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      position="center"
      visibleScrim
      class="w-100"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="p-6">
          <span class="text-ink text-sm font-semibold">
            {props.title ?? 'Add MCP Server'}
          </span>
        </Panel.Header>
        <Panel.Body class="p-6 flex flex-col gap-5">
          <div class="flex flex-col gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-xs text-ink-muted">Name</span>
              <input
                type="text"
                class="settings-input w-full"
                placeholder="My MCP Server"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                  if (e.key === 'Escape') close();
                }}
              />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-xs text-ink-muted">URL</span>
              <input
                type="url"
                class="settings-input w-full"
                placeholder="https://example.com/mcp"
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                  if (e.key === 'Escape') close();
                }}
              />
            </label>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={
                !name().trim() || !url().trim() || addMutation.isPending
              }
              onClick={handleSubmit}
            >
              {addMutation.isPending ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
