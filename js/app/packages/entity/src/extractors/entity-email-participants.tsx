import { useEmail } from '@core/context/user';
import { emailToMacroId, useDisplayName } from '@core/user';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { Tooltip } from '@core/component/Tooltip';
import { UserTooltip } from '@core/component/UserTooltip';
import {
  mergeAdjacentMacroEmTags,
  highlightTermsInText,
} from '@core/util/searchHighlight';
import type { EmailEntity, EmailThreadParticipants } from '../types/entity';
import { isSearchEntity } from '../types/search';
import { For, Show } from 'solid-js';

/** Checks if a value is likely an email address */
export function isLikelyEmail(value?: string): boolean {
  return typeof value === 'string' && value.includes('@');
}

/** Extracts the local part of an email address (before @) */
export function getEmailLocalPart(email: string): string {
  return email.split('@')[0];
}

/**
 * Resolves the best display name for a participant
 * Priority: macroDisplayName > participant.name > email local part
 */
export function resolveParticipantName(
  participant: EmailThreadParticipants[number],
  macroDisplayName?: string
): string {
  if (macroDisplayName && !isLikelyEmail(macroDisplayName)) {
    return macroDisplayName;
  }
  const participantFullName = participant.name ?? '';
  if (participantFullName && !isLikelyEmail(participantFullName)) {
    return participantFullName;
  }
  return getEmailLocalPart(participant.email);
}

type ResolvedParticipant = {
  participant: EmailThreadParticipants[number];
  displayName: string;
};

function ParticipantWithTooltip(props: {
  participant: EmailThreadParticipants[number];
  displayName: string;
  highlighted?: string;
}) {
  const macroId = () => emailToMacroId(props.participant.email);
  const [macroDisplayName] = useDisplayName(macroId());
  const tooltipName = () =>
    resolveParticipantName(props.participant, macroDisplayName());

  return (
    <Tooltip
      unstyled
      spanMode
      tooltip={
        <UserTooltip
          displayName={tooltipName()}
          email={props.participant.email}
          id={macroId()}
        />
      }
    >
      <Show
        when={props.highlighted}
        fallback={<span>{props.displayName}</span>}
      >
        {(md) => (
          <StaticMarkdown
            markdown={md()}
            theme={unifiedListMarkdownTheme}
            singleLine
          />
        )}
      </Show>
    </Tooltip>
  );
}

/**
 * Resolves participants into display-ready objects, handling the "me" case
 * and filtering out the current user.
 */
function resolveParticipants(
  participants: EmailThreadParticipants | undefined,
  userEmail: string | undefined,
  getMacroDisplayName: (email: string) => string | undefined
): ResolvedParticipant[] {
  if (!participants || participants.length === 0) return [];

  if (
    participants.length === 1 &&
    userEmail &&
    participants[0].email === userEmail
  ) {
    return [{ participant: participants[0], displayName: 'me' }];
  }

  const seen = new Set<string>();
  const result: ResolvedParticipant[] = [];

  for (const participant of participants) {
    if (!participant.email) continue;
    if (userEmail && participant.email === userEmail) continue;

    const macroDisplayName = getMacroDisplayName(participant.email);
    const displayName = resolveParticipantName(participant, macroDisplayName);

    if (seen.has(displayName)) continue;
    seen.add(displayName);

    result.push({ participant, displayName });
  }

  return result;
}

/**
 * Abbreviates resolved participants for display:
 * - 1 name: full name
 * - 2-3 names: first names only
 * - 4+ names: first, "..", second-to-last, last (first names)
 */
function abbreviateParticipants(
  resolved: ResolvedParticipant[]
): ResolvedParticipant[] {
  if (resolved.length <= 1) return resolved;

  const abbreviated = resolved.map((r) => ({
    ...r,
    displayName: r.displayName.split(' ')[0],
  }));

  if (abbreviated.length <= 3) return abbreviated;

  return [
    abbreviated[0],
    abbreviated[abbreviated.length - 2],
    abbreviated[abbreviated.length - 1],
  ];
}

/** Get a nicely formatted list of participants from an email entity. */
export function EntityEmailParticipants(props: { entity: EmailEntity }) {
  const userEmail = useEmail();
  const fetchDisplayName = (email: string) =>
    useDisplayName(emailToMacroId(email))[0]();

  const participants = () =>
    abbreviateParticipants(
      resolveParticipants(
        props.entity.participants,
        userEmail(),
        fetchDisplayName
      )
    );

  const allResolved = () =>
    resolveParticipants(
      props.entity.participants,
      userEmail(),
      fetchDisplayName
    );

  const searchTerms = () => {
    if (!isSearchEntity(props.entity)) return undefined;
    return props.entity.search.senderHighlightTerms;
  };

  const highlightName = (name: string) => {
    const terms = searchTerms();
    if (!terms?.length) return undefined;
    const result = mergeAdjacentMacroEmTags(highlightTermsInText(name, terms));
    return result !== name ? result : undefined;
  };

  const showEllipsis = () => allResolved().length >= 4;

  return (
    <For each={participants()}>
      {(resolved, index) => (
        <>
          <Show when={index() > 0}>
            {showEllipsis() && index() === 1 ? ' .. ' : ', '}
          </Show>
          <ParticipantWithTooltip
            participant={resolved.participant}
            displayName={resolved.displayName}
            highlighted={highlightName(resolved.displayName)}
          />
        </>
      )}
    </For>
  );
}
