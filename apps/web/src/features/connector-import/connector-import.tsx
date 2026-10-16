import {
  allOf,
  flagVerdict,
  SidebarPromotion,
  type Verdict,
} from '@app/features/sidebar-promotion/sidebar-promotion';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSidebarPromotions } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import {
  usePipedreamMcpFlag,
  usePipedreamMcpFlagResult,
} from '@core/pipedream/flag';
import { lazyNamed } from '@core/util/lazyNamed';
import { createSignal, type JSX, Show, Suspense } from 'solid-js';
import { IMPORT_CATEGORIES } from './core/catalog';
import type { ImportCategory } from './core/providers';
import { hideImportPromotion, importPromotionId } from './primitives/promotion';
import type { ImportAlternative } from './views/import-dialog';

export type { ImportAlternative } from './views/import-dialog';

const loadDialog = () => import('./connector-import-dialog');
const ConnectorImportDialogHost = lazyNamed(
  loadDialog,
  'ConnectorImportDialogHost'
);

/**
 * A view sidebar's prompt to import this category from other apps, and the
 * dialog it opens. Applies once connector import is rolled out to the user
 * and the Pipedream connector stack is on.
 */
export function ConnectorImportSidebar(props: {
  category: ImportCategory;
  /** The host's own gate, e.g. team membership; applies when omitted. */
  applies?: Verdict;
  alternatives?: readonly ImportAlternative[];
  class?: string;
}): JSX.Element {
  const flag = useFeatureFlag(enableSidebarPromotions);
  const pipedream = usePipedreamMcpFlagResult();
  return (
    <ConnectorImportPromotion
      {...props}
      applies={allOf(
        flagVerdict(flag()),
        flagVerdict(pipedream()),
        props.applies ?? true
      )}
    />
  );
}

/**
 * The card and dialog behind the host's own gate. Connector rows need the
 * Pipedream stack; with none available and a single alternative, the card
 * opens it directly.
 */
export function ConnectorImportPromotion(props: {
  category: ImportCategory;
  /** See `SidebarPromotion`: `undefined` while the host's gates load. */
  applies: Verdict;
  alternatives?: readonly ImportAlternative[];
  class?: string;
}): JSX.Element {
  const userId = useUserId();
  const pipedream = usePipedreamMcpFlag();
  const config = () => IMPORT_CATEGORIES[props.category];
  const dialogConfig = () => ({
    ...config(),
    providers: pipedream() ? config().providers : [],
  });
  const [open, setOpen] = createSignal(false);
  // The dialog's code loads on first open (and is fetched ahead on hover).
  const [opened, setOpened] = createSignal(false);
  const [opener, setOpener] = createSignal<HTMLButtonElement>();
  const hide = () => hideImportPromotion(userId(), props.category);
  // Alternatives open their own dialogs; hand them the card button for focus.
  const alternatives = (): ImportAlternative[] =>
    (props.alternatives ?? []).map((base) => ({
      ...base,
      onSelect: () => base.onSelect(opener()),
    }));
  const openDialog = (value: boolean) => {
    if (value) setOpened(true);
    setOpen(value);
  };

  return (
    <>
      <div
        class="contents"
        onPointerEnter={() => void loadDialog()}
        onFocusIn={() => void loadDialog()}
      >
        <SidebarPromotion
          id={importPromotionId(props.category)}
          applies={props.applies}
          logos={config().providers}
          headline={config().headline}
          pitch={config().pitch}
          class={props.class}
          action={{
            label: config().action,
            onClick: (trigger) => {
              setOpener(trigger);
              const [direct, ...others] = alternatives();
              if (!dialogConfig().providers.length && direct && !others.length)
                direct.onSelect();
              else openDialog(true);
            },
          }}
        />
      </div>
      {/* Beside the card: a finished import hides the card, not the dialog. */}
      <Show when={opened()}>
        <Suspense>
          <ConnectorImportDialogHost
            config={dialogConfig()}
            open={open()}
            onOpenChange={openDialog}
            opener={opener()}
            alternatives={alternatives()}
            onImported={hide}
          />
        </Suspense>
      </Show>
    </>
  );
}
