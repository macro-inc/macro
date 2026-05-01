import { Show } from 'solid-js';
import { DraftBadge } from '../../components/Badges';
import { Entity } from '../../entity';
import { HitSnippet } from '../../extractors-search/HitSnippet';
import { getSnippetHit } from '../../extractors-search/snippet-entity';
import type { EmailEntity } from '../../types/entity';

export function EmailIdentity(props: { entity: EmailEntity }) {
  return (
    <>
      <Show when={props.entity.isDraft}>
        <DraftBadge />
      </Show>
      <span class="truncate">
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
    </>
  );
}
