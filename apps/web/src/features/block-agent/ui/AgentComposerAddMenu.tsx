import {
  ComposerAddDrawer,
  ComposerAddMenu,
  type ComposerAddMenuGroup,
} from '@channel/Input/ComposerAddMenu';
import { ConnectedAppIcon } from '@core/connectors/ConnectedAppIcon';
import { useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { isMobile } from '@core/mobile/isMobile';
import { lazy } from '@core/util/lazy';
import LightningIcon from '@icon/system/regular/lightning.svg';
import PlugsIcon from '@icon/system/regular/plugs.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import BooksIcon from '@phosphor/books.svg';
import { Button, Dialog } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  CapabilityStatus,
  ProviderId,
} from '../../settings/connections/model';
import { providerIcon } from '../../settings/connections/provider-meta';
import { useConnectionsModel } from '../../settings/connections/use-connections-model';
import { agentAttachmentItems } from './attachment-menu';

const IntegrationsView = lazy(async () => ({
  default: (await import('../../settings/connections/integrations-view'))
    .IntegrationsView,
}));
const LeftoverRow = lazy(async () => ({
  default: (await import('../../settings/connections/leftover-row'))
    .LeftoverRow,
}));

type Target =
  | { kind: 'overview' }
  | { kind: 'provider'; provider: ProviderId; title: string }
  | { kind: 'other'; connectionId: string; title: string };

function connectionDescription(
  status: CapabilityStatus,
  account?: string
): string {
  return match(status)
    .with('connected', () => account || 'Open connection settings')
    .with('off', () => 'Disabled · Open settings')
    .with(
      'action-required',
      'not-connected',
      () => 'Needs attention · Open settings'
    )
    .exhaustive();
}

/** Shared composer actions plus the owner's existing connection settings. */
export function AgentComposerAddMenu(props: {
  openFiles: () => void;
  openImages: () => void;
  imageUnsupportedReason?: string;
  openLibrary: () => void;
  openSkills: () => void;
  getEditor: () => HTMLElement | null | undefined;
  session?: boolean;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const connections = useConnectionsModel();
  const settings = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();
  const [drawerOpen, updateDrawerOpen] = createSignal(false);
  const [target, updateTarget] = createSignal<Target>();
  const setDrawerOpen = (open: boolean) => {
    updateDrawerOpen(open);
    props.onOpenChange?.(open || !!target());
  };
  const setTarget = (next: Target | undefined) => {
    updateTarget(next);
    props.onOpenChange?.(drawerOpen() || !!next);
  };
  const openTarget = (next: Target) => {
    // Release the mobile add sheet before opening the next focus trap.
    if (isMobile()) queueMicrotask(() => setTarget(next));
    else setTarget(next);
  };
  const groups = (): ComposerAddMenuGroup[] => [
    {
      items: [
        ...agentAttachmentItems(
          props.openFiles,
          props.openImages,
          props.imageUnsupportedReason
        ),
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
          description: connectionDescription(
            connection.status,
            connection.account !== connection.title
              ? connection.account
              : undefined
          ),
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
          description: connectionDescription(connection.status),
          icon:
            connection.kind === 'app' ? (
              <ConnectedAppIcon appSlug={connection.appSlug} />
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
        ...(connections.error()
          ? [
              {
                id: 'retry',
                label: 'Retry connections',
                description: 'Connections could not be loaded',
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
          onSelect: () => openTarget({ kind: 'overview' }),
        },
        {
          id: 'manage',
          label: 'Manage connections',
          description: 'Accounts, permissions, and settings',
          icon: <PlugsIcon />,
          onSelect: () => openTarget({ kind: 'overview' }),
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
        contentClass="w-[min(42rem,calc(100vw-2rem))] max-h-[min(32rem,var(--kb-popper-content-available-height))] overflow-y-auto"
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
                    onOpenEmailSettings={() => {
                      setTarget(undefined);
                      settings.openSettings('Email');
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
