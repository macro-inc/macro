import { SearchOperatorText } from '@app/components/view-shell/search-operator-text';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { openExternalUrl } from '@core/util/url';
import ExternalIcon from '@icon/system/regular/arrow-square-out.svg';
import InfoIcon from '@icon/system/regular/info.svg';
import { buttonClasses, cn, HoverCard } from '@ui';
import { For } from 'solid-js';

/** An operator written out as an example, beside what it finds. */
export type SearchTip = { operator: string; finds: string };

/** A search field's most used operators, beside what each one finds. */
export function SearchTipList(props: {
  tips: readonly SearchTip[];
  class?: string;
}) {
  return (
    <dl
      class={cn(
        'grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2',
        props.class
      )}
    >
      <For each={props.tips}>
        {(tip) => (
          <>
            <dt class="whitespace-pre font-mono text-xs touch:text-sm">
              <SearchOperatorText
                parts={[{ text: tip.operator, operator: true }]}
              />
            </dt>
            <dd class="min-w-0 text-ink">{tip.finds}</dd>
          </>
        )}
      </For>
    </dl>
  );
}

/** The full list of operators, on the docs site. */
function SearchDocsLink(props: { url: string }) {
  return (
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink not-touch:hover:bg-hover"
      onClick={() => openExternalUrl(props.url)}
    >
      <ExternalIcon aria-hidden="true" class="size-4 shrink-0" />
      {t('searchOperators.allOperators')}
    </button>
  );
}

/**
 * The info button beside a search's title: hovering it lists the tips, and
 * pressing it opens the full list on the docs site.
 */
export function SearchTipsButton(props: {
  tips: readonly SearchTip[];
  docsUrl: string;
  class?: string;
}) {
  // A field that closes when it loses focus (Mail's empty wide field) would
  // take the button and its card with it, so a press keeps focus in place.
  const keepFieldFocus = (event: Event) => event.preventDefault();
  return (
    <span
      class="contents"
      onPointerDown={keepFieldFocus}
      onMouseDown={keepFieldFocus}
    >
      <HoverCard
        as="button"
        triggerAriaLabel={t('searchOperators.allOperators')}
        triggerOnClick={() => openExternalUrl(props.docsUrl)}
        triggerClass={cn(
          buttonClasses({ variant: 'ghost', size: 'icon-sm' }),
          props.class
        )}
        placement="bottom-start"
        contentClass="flex-col items-stretch p-3 text-sm text-ink"
        content={
          <div
            class="flex w-max max-w-[min(360px,calc(100vw-32px))] flex-col"
            onPointerDown={keepFieldFocus}
            onMouseDown={keepFieldFocus}
          >
            <SearchTipList tips={props.tips} class="px-2" />
            <div class="my-2 border-t border-edge-muted" />
            <SearchDocsLink url={props.docsUrl} />
          </div>
        }
      >
        <InfoIcon aria-hidden="true" class="size-3.5 shrink-0" />
      </HoverCard>
    </span>
  );
}

/** The same tips in a sheet, for a phone's search, which has no hover. */
export function SearchTipsSheet(props: {
  tips: readonly SearchTip[];
  docsUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label={t('searchOperators.tips')}>
          <MobileDrawer.Handle class="pb-1" />
          <MobileDrawer.Title
            as="h2"
            class="shrink-0 px-6 pb-4 text-lg font-semibold text-ink"
          >
            {t('searchOperators.tips')}
          </MobileDrawer.Title>
          <MobileDrawer.ScrollBody
            data-corvu-no-drag
            class="touch-pan-y gap-3 overscroll-contain pb-6"
          >
            <MobileDrawer.Section>
              <SearchTipList tips={props.tips} class="gap-y-4 p-3 text-base" />
            </MobileDrawer.Section>
            <MobileDrawer.Section>
              <MobileDrawer.Item onClick={() => openExternalUrl(props.docsUrl)}>
                <ExternalIcon aria-hidden="true" class="size-5 shrink-0" />
                {t('searchOperators.allOperators')}
              </MobileDrawer.Item>
            </MobileDrawer.Section>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
