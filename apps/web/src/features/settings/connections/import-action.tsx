import { importSourceFor } from '@app/features/connector-import/core/catalog';
import { fireAndForget } from '@core/util/fireAndForget';
import { lazyNamed } from '@core/util/lazyNamed';
import { Telemetry } from '@macro-inc/observability';
import { createSignal, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { ConnectAction } from '../integration-ui';

const loadDialog = () =>
  import('@app/features/connector-import/connector-import-dialog');
const ConnectorImportDialogHost = lazyNamed(
  loadDialog,
  'ConnectorImportDialogHost'
);

/**
 * Offers Macro's importer beside Connect for apps it can import from: the
 * importer copies the app's data into Macro, while Connect only gives agents
 * the app's tools.
 */
export function ImportAction(props: { appSlug: string; name: string }) {
  const source = () => importSourceFor(props.appSlug);
  const [open, setOpen] = createSignal(false);
  // The dialog's code loads on first open.
  const [opened, setOpened] = createSignal(false);
  const [opener, setOpener] = createSignal<HTMLElement>();

  return (
    <Show when={source()}>
      {(found) => (
        <>
          <ConnectAction
            label="Import"
            variant="neutral"
            ariaLabel={`Import from ${props.name}`}
            onClick={() => {
              const active = document.activeElement;
              setOpener(active instanceof HTMLElement ? active : undefined);
              // Mount only once the dialog's code has loaded, so a failed
              // chunk load leaves Import available to retry.
              fireAndForget(
                Telemetry.span('connector_import.open', async (span) => {
                  span.setAttr('connector.app_slug', props.appSlug);
                  await loadDialog();
                  setOpened(true);
                  setOpen(true);
                }),
                'connections-settings'
              );
            }}
          />
          <Show when={opened()}>
            <Suspense>
              <ConnectorImportDialogHost
                config={{ ...found().config, providers: [found().provider] }}
                open={open()}
                onOpenChange={setOpen}
                opener={opener()}
              />
            </Suspense>
          </Show>
        </>
      )}
    </Show>
  );
}

/** One line on what connecting an app does in Macro, not what the app is. */
export function connectorDescription(appSlug: string, name: string): string {
  const found = importSourceFor(appSlug);
  if (!found) {
    return `Agents can use ${name} when you ask them to. Nothing is copied into Macro.`;
  }
  const destination = match(found.config.category)
    .with('files', () => 'your Drive')
    .with('tasks', () => 'Tasks')
    .with('crm', () => 'the CRM')
    .with('channels', () => 'Macro')
    .exhaustive();
  const items = found.provider.detail;
  return `Import ${items.charAt(0).toLowerCase()}${items.slice(1)} into ${destination}, or connect so agents can use ${name} without copying anything.`;
}
