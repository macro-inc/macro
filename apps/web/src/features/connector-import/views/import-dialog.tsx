import { LogoStack } from '@app/features/sidebar-promotion/components/logo-stack';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { ActionDialogShell, Dialog } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ProviderRow, type ProviderRowState } from '../components/provider-row';
import { SecurityNote } from '../components/security-note';
import { useConnectorImport } from '../context/connector-import-context';
import { agentImportHandoff } from '../core/agent-handoff';
import type { ImportCategoryConfig, ImportProvider } from '../core/providers';

/** Another way in that does not go through a connector, e.g. a CSV upload. */
export type ImportAlternative = {
  icon: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element;
  label: string;
  description: string;
  /** `opener` is the card button, for the next dialog to return focus to. */
  onSelect(opener?: HTMLButtonElement): void;
};

export function ConnectorImportDialog(props: {
  config: ImportCategoryConfig;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Focus returns here on close; the card sits outside Dialog's trigger. */
  opener?: HTMLElement;
  /** Ways in that skip connectors, e.g. a CSV or local upload. */
  alternatives?: readonly ImportAlternative[];
}): JSX.Element {
  let content: HTMLDivElement | undefined;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-120"
      visibleScrim
      contentRef={(element) => {
        content = element;
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        props.opener?.focus();
      }}
    >
      <Show when={props.open}>
        <ImportDialogBody
          config={props.config}
          container={() => content}
          alternatives={props.alternatives}
          onClose={() => props.onOpenChange(false)}
        />
      </Show>
    </Dialog>
  );
}

function ImportDialogBody(props: {
  config: ImportCategoryConfig;
  container: () => HTMLElement | undefined;
  /** Ways in that skip connectors, e.g. a CSV or local upload. */
  alternatives?: readonly ImportAlternative[];
  onClose(): void;
}): JSX.Element {
  const context = useConnectorImport();
  const connections = context.createConnections();
  const [connecting, setConnecting] = createSignal<string>();
  const [handingOff, setHandingOff] = createSignal(false);

  function rowState(provider: ImportProvider): ProviderRowState {
    if (connecting() === provider.appSlug) return 'connecting';
    if (!connections.ready()) return 'unknown';
    return connections.connected().has(provider.appSlug)
      ? 'connected'
      : 'disconnected';
  }

  async function connect(provider: ImportProvider) {
    if (connecting()) return;
    setConnecting(provider.appSlug);
    try {
      const outcome = await context.connect(
        {
          appSlug: provider.appSlug,
          name: provider.name,
          mcpUrl: provider.mcpUrl,
        },
        props.container()
      );
      if (outcome === 'unsupported') {
        toast.failure('Connectors are not available on this deployment');
      }
    } catch {
      toast.failure(`Couldn't connect ${provider.name}`);
    } finally {
      setConnecting(undefined);
    }
  }

  // Every import runs in an agent chat that opens in a split beside the view.
  async function startImport(provider: ImportProvider) {
    if (handingOff()) return;
    setHandingOff(true);
    try {
      await context.startAgentImport(
        agentImportHandoff(props.config, provider)
      );
      props.onClose();
    } finally {
      setHandingOff(false);
    }
  }

  return (
    // The `contents` wrapper hides this shell from Dialog's surface reset.
    <div class="contents">
      <ActionDialogShell
        hideBorder
        class="max-h-[85dvh] rounded-[24px] bg-transparent"
      >
        <ActionDialogShell.Body class="space-y-4">
          <ActionDialogShell.Header>
            <LogoStack
              logos={props.config.providers}
              class="mb-3 [--logo-stack-separator:var(--color-dialog)]"
            />
            <ActionDialogShell.Title>
              {props.config.action}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {props.config.dialogDescription}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          <ul
            class="rounded-2xl bg-ink/3 px-3 py-1"
            aria-label={`Apps to ${props.config.action.toLowerCase()} from`}
          >
            <For each={props.config.providers}>
              {(provider) => (
                <ProviderRow
                  provider={provider}
                  state={rowState(provider)}
                  disabled={
                    handingOff() ||
                    (connecting() !== undefined &&
                      connecting() !== provider.appSlug)
                  }
                  onConnect={() =>
                    fireAndForget(connect(provider), 'connector-import.connect')
                  }
                  onImport={() =>
                    fireAndForget(
                      startImport(provider),
                      'connector-import.start'
                    )
                  }
                />
              )}
            </For>
          </ul>
          <Show when={props.alternatives?.length}>
            <div class="flex flex-col gap-2">
              <For each={props.alternatives}>
                {(alternative) => (
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 rounded-2xl bg-ink/3 px-3 py-3 text-left hover:bg-ink/5 focus-visible:outline-accent"
                    onClick={() => {
                      props.onClose();
                      alternative.onSelect();
                    }}
                  >
                    <Dynamic
                      component={alternative.icon}
                      class="size-5 shrink-0 text-ink-muted"
                      aria-hidden="true"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-medium text-ink">
                        {alternative.label}
                      </span>
                      <span class="block text-xs text-ink-muted">
                        {alternative.description}
                      </span>
                    </span>
                    <CaretRightIcon
                      class="size-4 text-ink-extra-muted"
                      aria-hidden="true"
                    />
                  </button>
                )}
              </For>
            </div>
          </Show>
          <SecurityNote />
        </ActionDialogShell.Body>
      </ActionDialogShell>
    </div>
  );
}
