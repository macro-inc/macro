import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useEmailLinksQuery } from '@queries/email/link';
import { cn } from '@ui';
import { type Accessor, createMemo, Show } from 'solid-js';
import { DraftBadge } from '../../components/Badges';
import { Entity } from '../../entity';
import { HitSnippet } from '../../extractors-search/HitSnippet';
import { getSnippetHit } from '../../extractors-search/snippet-entity';
import type { EmailEntity } from '../../types/entity';

/**
 * Resolves the linked inbox a thread belongs to, but only when the user has
 * more than one accessible inbox (a single inbox needs no attribution) and the
 * thread's link is one the user can see. Returns undefined otherwise — e.g. a
 * thread shared with the user that isn't one of their own/delegated inboxes.
 */
export function useOwningInbox(entity: Accessor<EmailEntity | undefined>) {
  const linksQuery = useEmailLinksQuery();
  return createMemo(() => {
    const linkId = entity()?.linkId;
    if (!linkId) return undefined;
    const links = linksQuery.data?.links ?? [];
    if (links.length <= 1) return undefined;
    return links.find((l) => l.id === linkId);
  });
}

/**
 * Shows which linked inbox a thread belongs to as the inbox's icon (full
 * address on hover), resolved by email so an own secondary inbox shows its own
 * identity rather than the parent account's.
 */
export function EmailInboxChip(props: { entity: EmailEntity; class?: string }) {
  const inbox = useOwningInbox(() => props.entity);
  return (
    <Show when={inbox()}>
      {(link) => (
        <span
          class={cn('flex shrink-0 items-center', props.class)}
          title={link().email_address}
        >
          <UserIcon
            {...inboxIconProps(link().email_address)}
            photoUrl={link().photo_url ?? undefined}
            size="sm"
            suppressClick
            class="shrink-0"
          />
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
      <span class="w-(--title-width) shrink-0 flex items-center gap-2">
        <span class="truncate max-w-32 flex gap-2 items-center">
          <EmailIdentity entity={props.entity} />
        </span>
        <EmailInboxChip entity={props.entity} class="ml-auto" />
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
    </>
  );
}
