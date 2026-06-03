import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useEmailLinksQuery } from '@queries/email/link';
import { cn } from '@ui';
import { createMemo, Show } from 'solid-js';
import { DraftBadge } from '../../components/Badges';
import { Entity } from '../../entity';
import { HitSnippet } from '../../extractors-search/HitSnippet';
import { getSnippetHit } from '../../extractors-search/snippet-entity';
import type { EmailEntity } from '../../types/entity';

/**
 * Shows which linked inbox a thread belongs to, mirroring the composer's
 * "from" chip: the inbox's icon and address, resolved by email so an own
 * secondary inbox shows its own identity rather than the parent account's.
 * Only renders when the user has more than one accessible inbox — a single
 * inbox needs no attribution.
 */
export function EmailInboxChip(props: { entity: EmailEntity; class?: string }) {
  const linksQuery = useEmailLinksQuery();
  const inbox = createMemo(() => {
    const links = linksQuery.data?.links ?? [];
    if (links.length <= 1) return undefined;
    const linkId = props.entity.linkId;
    if (!linkId) return undefined;
    return links.find((l) => l.id === linkId);
  });
  return (
    <Show when={inbox()}>
      {(link) => (
        <span
          class={cn(
            'flex shrink-0 items-center gap-1 text-ink-extra-muted text-xs font-normal max-w-32',
            props.class
          )}
          title={link().email_address}
        >
          <UserIcon
            {...inboxIconProps(link().email_address)}
            size="sm"
            suppressClick
            class="shrink-0"
          />
          <span class="truncate">{link().email_address.split('@')[0]}</span>
        </span>
      )}
    </Show>
  );
}

export function EmailIdentity(props: { entity: EmailEntity }) {
  return (
    <>
      <Show when={props.entity.isDraft}>
        <DraftBadge />
      </Show>
      <span class="truncate min-w-0">
        <Entity.EmailParticipants entity={props.entity} />
      </span>
    </>
  );
}

function EmailSnippet(props: {
  entity: EmailEntity;
  showHitSnippet: boolean;
  chars: number;
}) {
  return (
    <Show
      when={props.showHitSnippet && getSnippetHit(props.entity)}
      fallback={props.entity.snippet}
    >
      {(hit) => <HitSnippet content={hit().content} chars={props.chars} />}
    </Show>
  );
}

export function EmailNarrowBody(props: {
  entity: EmailEntity;
  chars: number;
  showHitSnippet: boolean;
  setContainerRef: (el: HTMLElement) => void;
}) {
  return (
    <Entity.Slot placement="body" class="flex flex-col pb-2 min-h-[2lh] pr-4">
      <Entity.Title entity={props.entity} />
      <span
        ref={props.setContainerRef}
        class="text-ink/50 font-medium truncate"
      >
        <EmailSnippet
          entity={props.entity}
          showHitSnippet={props.showHitSnippet}
          chars={props.chars}
        />
      </span>
    </Entity.Slot>
  );
}

export function EmailWideContent(props: {
  entity: EmailEntity;
  chars: number;
  showHitSnippet: boolean;
  setContainerRef: (el: HTMLElement) => void;
}) {
  return (
    <>
      <span class="w-(--title-width) shrink-0">
        <span class="truncate max-w-32 flex gap-2 items-center">
          <EmailIdentity entity={props.entity} />
        </span>
      </span>
      <span class="truncate">
        <Entity.Title entity={props.entity} />
      </span>
      <span
        ref={props.setContainerRef}
        class="text-ink/50 font-medium truncate flex-1 inline-flex items-center"
      >
        <EmailSnippet
          entity={props.entity}
          showHitSnippet={props.showHitSnippet}
          chars={props.chars}
        />
      </span>
      <EmailInboxChip entity={props.entity} />
    </>
  );
}
