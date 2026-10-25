import {
  ComposerAddDrawer,
  ComposerAddMenu,
  type ComposerAddMenuGroup,
} from '@channel/Input/ComposerAddMenu';
import { useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { isMobile } from '@core/mobile/isMobile';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import BooksIcon from '@phosphor/books.svg';
import LightningIcon from '@phosphor/lightning.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import PlugsIcon from '@phosphor/plugs.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dialog } from '@ui';
import { createSignal, lazy, Show, Suspense } from 'solid-js';
import type { ProviderId } from '../../settings/connections/model';
import { providerIcon } from '../../settings/connections/provider-meta';
import { useConnectionsModel } from '../../settings/connections/use-connections-model';

const IntegrationsView = lazy(async () => ({
  default: (await import('../../settings/connections/integrations-view'))
    .IntegrationsView,
}));
const LeftoverRow = lazy(async () => ({
  default: (await import('../../settings/connections/leftover-row'))
    .LeftoverRow,
}));

type Target =
  | { kind: 'overview'; mode: 'connected' | 'discover' }
  | { kind: 'provider'; provider: ProviderId; title: string }
  | { kind: 'other'; connectionId: string; title: string };

/** Shared composer actions plus the owner's existing connection settings. */
export function AgentComposerAddMenu(props: {
  openFiles: () => void;
  openLibrary: () => void;
  openSkills: () => void;
  getEditor: () => HTMLElement | null | undefined;
  session?: boolean;
  disabled?: boolean;
}) {
  const connections = useConnectionsModel();
  const settings = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [target, setTarget] = createSignal<Target>();
  const openTarget = (next: Target) => {
    // Release the mobile add sheet before opening the next focus trap.
    if (isMobile()) queueMicrotask(() => setTarget(next));
    else setTarget(next);
  };
  const groups = (): ComposerAddMenuGroup[] => [
    {
      items: [
        {
          id: 'upload',
          label: 'Add photos & files',
          description: 'Upload from your device',
          icon: <PaperclipIcon />,
          onSelect: props.openFiles,
        },
        {
          id: 'library',
          label: 'Add from library',
          description: 'Reference docs, people, or channels',
          icon: <BooksIcon />,
          hint: '@',
          onSelect: props.openLibrary,
          focusesEditor: true,
        },
        {
          id: 'skills',
          label: props.session ? 'Skills & commands' : 'Use a skill',
          description: 'Browse available skills',
          icon: <LightningIcon />,
          hint: '/',
          onSelect: props.openSkills,
          focusesEditor: true,
        },
      ],
    },
    {
      label: 'Connections',
      items: [
        ...connections.model().capabilities.map((connection) => ({
          id: connection.id,
          label: connection.title,
          description:
            connection.status === 'connected'
              ? (connection.account !== connection.title &&
                  connection.account) ||
                'Open connection settings'
              : connection.status === 'off'
                ? 'Disabled · Open settings'
                : 'Needs attention · Open settings',
          icon: providerIcon(connection.provider),
          onSelect: () =>
            openTarget({
              kind: 'provider',
              provider: connection.provider,
              title: connection.title,
            }),
        })),
        ...connections.model().leftovers.map((connection) => ({
          id: connection.id,
          label: connection.title,
          description: connection.enabled
            ? 'Open connection settings'
            : 'Disabled · Open settings',
          icon:
            connection.kind === 'pipedream' ? (
              <PipedreamConnectorIcon appSlug={connection.appSlug} />
            ) : (
              <PlugsIcon />
            ),
          onSelect: () =>
            openTarget({
              kind: 'other',
              connectionId: connection.id,
              title: connection.title,
            }),
        })),
        ...(!connections.ready()
          ? [
              {
                id: 'loading',
                label: 'Loading connections…',
                icon: <PlugsIcon />,
                disabled: true,
                onSelect: () => {},
              },
            ]
          : []),
        ...(connections.partialError()
          ? [
              {
                id: 'retry',
                label: 'Retry connections',
                description: 'Some connections could not be loaded',
                icon: <PlugsIcon />,
                onSelect: connections.retry,
              },
            ]
          : []),
        {
          id: 'connect',
          label: 'Add connections',
          description: 'Connect more apps to Macro',
          icon: <PlusIcon />,
          onSelect: () => openTarget({ kind: 'overview', mode: 'discover' }),
        },
        {
          id: 'manage',
          label: 'Manage connections',
          description: 'Accounts, permissions, and settings',
          icon: <PlugsIcon />,
          onSelect: () => openTarget({ kind: 'overview', mode: 'connected' }),
        },
      ],
    },
  ];
  return (
    <>
      <ComposerAddMenu
        groups={groups()}
        disabled={props.disabled}
        onOpenDrawer={() => setDrawerOpen(true)}
        placement="bottom-start"
        contentClass="w-[min(42rem,calc(100vw-2rem))] max-h-[min(32rem,var(--kb-popper-content-available-height))] overflow-y-auto rounded-2xl"
      />
      <ComposerAddDrawer
        groups={groups()}
        getEditor={props.getEditor}
        open={drawerOpen()}
        onOpenChange={setDrawerOpen}
      />
      <Show when={target()} keyed>
        {(selected) => (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setTarget(undefined);
            }}
            position="center"
            visibleScrim
            class="w-[min(46rem,calc(100vw-2rem))] max-h-[85dvh] overflow-y-auto rounded-2xl bg-panel"
          >
            <div class="flex items-center justify-between gap-3 border-b border-edge-muted px-5 py-3">
              <Dialog.Title class="text-base font-medium">
                {selected.kind === 'overview' ? 'Connections' : selected.title}
              </Dialog.Title>
              <Dialog.CloseButton as={Button} variant="ghost" size="sm">
                Done
              </Dialog.CloseButton>
            </div>
            <Suspense
              fallback={
                <p role="status" class="p-5 text-sm text-ink-muted">
                  Loading connection settings…
                </p>
              }
            >
              <Show
                when={selected.kind === 'other' ? selected : undefined}
                fallback={
                  <IntegrationsView
                    initialProvider={
                      selected.kind === 'provider'
                        ? selected.provider
                        : undefined
                    }
                    onOpenLocalAgents={
                      isTabAvailable('Harness')
                        ? () => {
                            setTarget(undefined);
                            settings.openSettings('Harness');
                          }
                        : undefined
                    }
                    onOpenMacroMcp={() => {
                      setTarget(undefined);
                      settings.openSettings('Agent');
                    }}
                  />
                }
              >
                {(other) => (
                  <div class="p-5">
                    <Show
                      when={connections
                        .model()
                        .leftovers.find(
                          (connection) => connection.id === other().connectionId
                        )}
                      fallback={
                        <p class="text-sm text-ink-muted">
                          This connection is no longer available.
                        </p>
                      }
                    >
                      {(connection) => <LeftoverRow leftover={connection()} />}
                    </Show>
                  </div>
                )}
              </Show>
            </Suspense>
          </Dialog>
        )}
      </Show>
    </>
  );
}
