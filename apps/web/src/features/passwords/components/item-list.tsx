import { formatLocale, t } from '@app/lib/i18n';
import StarFillIcon from '@icon/system/fill/star-fill.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { cn } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { PasswordDraft, PasswordItem } from '../core/types';
import { ItemLogo } from './item-logo';
import { PASSWORD_ITEM_DRAG_TYPE } from './vault-sidebar';

function hostname(url: string | null) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function Row(props: {
  active: boolean;
  onSelect: () => void;
  draggableId?: string;
  logo: JSX.Element;
  title: string;
  subtitle: string;
  trailing: JSX.Element;
}) {
  return (
    <li class="min-w-0">
      <button
        type="button"
        draggable={props.draggableId ? 'true' : 'false'}
        onDragStart={(event) => {
          if (props.draggableId)
            event.dataTransfer?.setData(
              PASSWORD_ITEM_DRAG_TYPE,
              props.draggableId
            );
        }}
        aria-current={props.active ? 'true' : undefined}
        onClick={props.onSelect}
        class={cn(
          'flex h-12 w-full min-w-0 items-center gap-3 rounded-lg px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent touch:min-h-14',
          props.active ? 'bg-active' : 'not-touch:hover:bg-hover'
        )}
      >
        {props.logo}
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm text-ink">{props.title}</span>
          <span class="truncate text-xs text-ink-muted">{props.subtitle}</span>
        </span>
        {props.trailing}
      </button>
    </li>
  );
}

export function ItemList(props: {
  items: PasswordItem[];
  drafts: { key: string; draft: PasswordDraft }[];
  selectedItemId?: string;
  selectedDraftKey?: string;
  onSelect: (item: PasswordItem) => void;
  onSelectDraft: (key: string) => void;
  loadLogo: (domain: string) => Promise<string | undefined>;
}) {
  const date = (value: string) =>
    new Intl.DateTimeFormat(formatLocale(), {
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  return (
    <ul class="flex min-w-0 flex-col gap-px px-2 py-1">
      <For each={props.drafts}>
        {(entry) => (
          <Row
            active={props.selectedDraftKey === entry.key}
            onSelect={() => props.onSelectDraft(entry.key)}
            logo={
              <ItemLogo
                name={entry.draft.name}
                kind={entry.draft.kind}
                url={null}
                loadLogo={props.loadLogo}
              />
            }
            title={entry.draft.name.trim() || t('passwords.untitled')}
            subtitle={t(`passwords.${entry.draft.kind}`)}
            trailing={
              <span class="shrink-0 rounded-full border border-edge-muted px-2 py-0.5 text-xs text-ink-muted">
                {t('passwords.draft')}
              </span>
            }
          />
        )}
      </For>
      <For each={props.items}>
        {(item) => (
          <Row
            active={props.selectedItemId === item.id}
            onSelect={() => props.onSelect(item)}
            draggableId={item.canManage ? item.id : undefined}
            logo={
              <ItemLogo
                name={item.name}
                kind={item.kind}
                url={item.url}
                loadLogo={props.loadLogo}
              />
            }
            title={item.name}
            subtitle={[t(`passwords.${item.kind}`), hostname(item.url)]
              .filter(Boolean)
              .join(' · ')}
            trailing={
              <>
                <span class="w-20 shrink-0 text-right text-xs text-ink-muted max-md:hidden">
                  <Show
                    when={item.sharedWithTeam}
                    fallback={
                      <span class="inline-flex items-center gap-1">
                        <LockIcon class="size-3.5 shrink-0" />
                        {t('passwords.private')}
                      </span>
                    }
                  >
                    <span class="inline-flex items-center gap-1">
                      <UsersIcon class="size-3.5 shrink-0" />
                      {t('passwords.team')}
                    </span>
                  </Show>
                </span>
                <span class="w-14 shrink-0 text-right text-xs text-ink-muted max-sm:hidden">
                  {item.lastUsedAt
                    ? date(item.lastUsedAt)
                    : t('passwords.neverUsed')}
                </span>
                <span class="flex w-4 shrink-0 justify-center">
                  <Show when={item.favorite}>
                    <StarFillIcon
                      aria-hidden={false}
                      aria-label={t('passwords.favorite')}
                      class="size-3.5 text-warning"
                    />
                  </Show>
                </span>
              </>
            }
          />
        )}
      </For>
    </ul>
  );
}
