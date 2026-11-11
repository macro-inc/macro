import {
  allOf,
  flagVerdict,
  type PromoAction,
  SidebarPromotion,
  type Verdict,
} from '@app/features/sidebar-promotion/sidebar-promotion';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSidebarPromotions } from '@core/constant/featureFlags';
import {
  usePipedreamMcpFlag,
  usePipedreamMcpFlagResult,
} from '@core/pipedream/flag';
import { fireAndForget } from '@core/util/fireAndForget';
import { lazyNamed } from '@core/util/lazyNamed';
import { createSignal, type JSX, Show, Suspense } from 'solid-js';
import { IMPORT_CATEGORIES } from './core/catalog';
import type { ImportCategory } from './core/providers';
import { importPromotionId } from './primitives/promotion';
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
  /** A shorter card button label, for when a second action shares the row. */
  actionLabel?: string;
  /** A second button beside the import action, e.g. to start from scratch. */
  secondaryAction?: PromoAction;
  class?: string;
}): JSX.Element {
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
        onPointerEnter={() =>
          fireAndForget(loadDialog(), 'connector-import.preload')
        }
        onFocusIn={() =>
          fireAndForget(loadDialog(), 'connector-import.preload')
        }
      >
        <SidebarPromotion
          id={importPromotionId(props.category)}
          applies={props.applies}
          logos={config().providers}
          headline={config().headline}
          pitch={config().pitch}
          class={props.class}
          action={{
            label: props.actionLabel ?? config().action,
            onClick: (trigger) => {
              setOpener(trigger);
              const [direct, ...others] = alternatives();
              if (!dialogConfig().providers.length && direct && !others.length)
                direct.onSelect();
              else openDialog(true);
            },
          }}
          secondaryAction={props.secondaryAction}
          dismissLabel={`Dismiss ${config().action.toLowerCase()}`}
        />
      </div>
      {/* Beside the card, so the dialog outlives the card's own gates. */}
      <Show when={opened()}>
        <Suspense>
          <ConnectorImportDialogHost
            config={dialogConfig()}
            open={open()}
            onOpenChange={openDialog}
            opener={opener()}
            alternatives={alternatives()}
          />
        </Suspense>
      </Show>
    </>
  );
}
