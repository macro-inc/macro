import { LogoStack } from '@app/features/sidebar-promotion/components/logo-stack';
import { toast } from '@core/component/Toast/Toast';
import CaretRightIcon from '@phosphor/caret-right.svg';
import type { ImportSource } from '@service-cognition/import';
import { ActionDialogShell, Dialog } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ProviderRow, type ProviderRowState } from '../components/provider-row';
import { SecurityNote } from '../components/security-note';
import { useConnectorImport } from '../context/connector-import-context';
import { agentImportHandoff } from '../core/agent-handoff';
import type { ImportCategoryConfig, ImportProvider } from '../core/providers';
import { NativeImportPane } from './native-import-pane';

/** Another way in that does not go through a connector, e.g. a CSV upload. */
export type ImportAlternative = {
  icon: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element;
  label: string;
  description: string;
  /** `opener` is the card button, for the next dialog to return focus to. */
  onSelect(opener?: HTMLButtonElement): void;
};

type NativeProvider = ImportProvider & { native: ImportSource };

function isNative(provider: ImportProvider): provider is NativeProvider {
  return provider.native !== undefined;
}

export function ConnectorImportDialog(props: {
  config: ImportCategoryConfig;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Focus returns here on close; the card sits outside Dialog's trigger. */
  opener?: HTMLElement;
  /** Ways in that skip connectors, e.g. a CSV or local upload. */
  alternatives?: readonly ImportAlternative[];
  onImported(): void;
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
          onImported={props.onImported}
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
  onImported(): void;
}): JSX.Element {
  const context = useConnectorImport();
  const connections = context.createConnections();
  const [connecting, setConnecting] = createSignal<string>();
  const [handingOff, setHandingOff] = createSignal(false);
  const [picking, setPicking] = createSignal<NativeProvider>();

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
        { appSlug: provider.appSlug, name: provider.name },
        props.container()
      );
      if (outcome === 'unsupported') {
        toast.failure('Connectors are not available on this deployment');
      } else if (outcome === 'connected' && isNative(provider)) {
        setPicking(provider);
      }
    } catch {
      toast.failure(`Couldn't connect ${provider.name}`);
    } finally {
      setConnecting(undefined);
    }
  }

  async function startImport(provider: ImportProvider) {
    if (isNative(provider)) {
      setPicking(provider);
      return;
    }
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

  // A stable element: swapping panes at the root of Dialog content left the
  // previous pane mounted beside the next one.
  return (
    <div class="contents">
      <Show
        when={picking()}
        fallback={
          <ActionDialogShell class="max-h-[85dvh]">
            <ActionDialogShell.Body class="space-y-4">
              <ActionDialogShell.Header>
                <LogoStack
                  logos={props.config.providers}
                  size="md"
                  class="mb-3 [--logo-stack-separator:var(--color-surface)]"
                />
                <ActionDialogShell.Title>
                  {props.config.action}
                </ActionDialogShell.Title>
                <ActionDialogShell.Description>
                  {props.config.dialogDescription}
                </ActionDialogShell.Description>
              </ActionDialogShell.Header>
              <ul
                class="divide-y divide-edge-muted"
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
                      onConnect={() => void connect(provider)}
                      onImport={() => void startImport(provider)}
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
                        class="flex w-full items-center gap-3 rounded-lg border border-edge-muted p-3 text-left hover:bg-ink/4 focus-visible:outline-accent"
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
        }
      >
        {(provider) => (
          <NativeImportPane
            provider={provider()}
            onBack={() => setPicking(undefined)}
            onImported={props.onImported}
          />
        )}
      </Show>
    </div>
  );
}
