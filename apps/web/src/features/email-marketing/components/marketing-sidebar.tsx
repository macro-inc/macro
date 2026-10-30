import { useViewShell, ViewSidebar } from '@app/components/view-shell';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import FlowArrowIcon from '@icon/system/regular/tree-structure.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { type Component, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type Section = 'campaigns' | 'contacts' | 'unsubscribed' | 'delivery';

export const SECTIONS: { id: Section; icon: Component<{ class?: string }> }[] =
  [
    { id: 'campaigns', icon: FlowArrowIcon },
    { id: 'contacts', icon: UsersIcon },
    { id: 'unsubscribed', icon: ProhibitIcon },
    { id: 'delivery', icon: EnvelopeIcon },
  ];

const SECTION_LABELS = {
  campaigns: 'emailMarketing.campaigns',
  contacts: 'emailMarketing.contacts',
  unsubscribed: 'emailMarketing.unsubscribedSection',
  delivery: 'emailMarketing.delivery',
} as const satisfies Record<Section, string>;

export function sectionLabel(section: Section) {
  return t(SECTION_LABELS[section]);
}

export function MarketingSidebar(props: {
  section: Section;
  counts: Partial<Record<Section, number>>;
  attention: number;
  canCreate: boolean;
  disabled: boolean;
  onSelect: (section: Section) => void;
  onCreate: () => void;
}) {
  const shell = useViewShell();
  // A narrow layout shows navigation over the content: get out of the way.
  const done = () => {
    if (shell.aside.isOverlay()) shell.aside.collapse();
  };
  return (
    <ViewSidebar.Root aria-label={t('emailMarketing.navigation')}>
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title caret={false}>
            {t('nav.emailMarketing')}
          </ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>
      <ViewSidebar.Primary>
        <ViewCreateButton
          presentation="sidebar"
          aria-label={t('emailMarketing.newCampaign')}
          disabled={!props.canCreate || props.disabled}
          onClick={() => {
            done();
            props.onCreate();
          }}
        />
      </ViewSidebar.Primary>
      <ViewSidebar.Content>
        <ViewSidebar.Nav aria-label={t('emailMarketing.navigation')}>
          <For each={SECTIONS}>
            {(item) => (
              <ViewSidebar.Item
                active={props.section === item.id}
                disabled={props.disabled}
                onClick={() => {
                  done();
                  props.onSelect(item.id);
                }}
              >
                <ViewSidebar.Icon>
                  <Dynamic component={item.icon} class="size-4" />
                </ViewSidebar.Icon>
                <span class="truncate">{sectionLabel(item.id)}</span>
                <Show
                  when={item.id === 'campaigns' && props.attention}
                  fallback={
                    <Show when={props.counts[item.id]}>
                      {(count) => (
                        <ViewSidebar.Trailing class="text-xs text-ink-subtle">
                          {count()}
                        </ViewSidebar.Trailing>
                      )}
                    </Show>
                  }
                >
                  <ViewSidebar.Trailing
                    class="text-xs text-failure"
                    title={t('emailMarketing.needAttentionCount', {
                      count: props.attention,
                    })}
                  >
                    {props.attention}
                  </ViewSidebar.Trailing>
                </Show>
              </ViewSidebar.Item>
            )}
          </For>
        </ViewSidebar.Nav>
      </ViewSidebar.Content>
    </ViewSidebar.Root>
  );
}
