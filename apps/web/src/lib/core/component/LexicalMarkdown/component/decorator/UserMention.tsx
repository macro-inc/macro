import { UserCardTrigger } from '@core/component/UserCardTrigger';
import { getDisplayNameParts, macroIdToEmail, tryMacroId } from '@core/user';
import type { UserMentionDecoratorProps } from '@macro-inc/lexical-core';
import { useBotProfile } from '@queries/bots/profiles';
import { queryReadyGate } from '@queries/gate';
import { cn } from '@ui';
import { createEffect, createMemo } from 'solid-js';
import { useUserMentionHost } from '../../decorator-host/user-mention-host';

function emailLocalPart(email: string): string {
  return email.split('@')[0] || email;
}

/** Legacy imports preserve absent/null identity fields until the view coerces them. */
export type UserMentionProps = Omit<
  UserMentionDecoratorProps,
  'userId' | 'email' | 'mentionUuid'
> & {
  userId: string | null | undefined;
  email: string | null | undefined;
  mentionUuid?: string | null;
};

export function UserMention(props: UserMentionProps) {
  const host = useUserMentionHost();
  const isSelectedAsNode = () => host.isSelected(props.key);

  // Convert String wrapper to primitive string
  const userId = () => String(props.userId);
  const propEmail = () => String(props.email);
  const propDisplayName = () => props.displayName?.trim() ?? '';

  const macroId = createMemo(() =>
    props.userId ? tryMacroId(userId()) : undefined
  );

  // An agent mention shows the agent's name as it is now; the name stored in
  // the mention is the one it had when it was written.
  const botId = () =>
    userId().startsWith('bot|') ? userId().slice('bot|'.length) : '';
  const bot = useBotProfile(botId);
  const botName = () =>
    botId() && queryReadyGate(bot) ? bot.data?.name : undefined;

  const email = createMemo(() => {
    const id = macroId();
    if (id) return macroIdToEmail(id);
    return propEmail();
  });

  const displayNameParts = createMemo(() => {
    const id = macroId();
    if (!id) return undefined;
    return getDisplayNameParts(id, { emailFallback: 'local-part' });
  });

  const mentionDisplayName = createMemo(() => {
    const parts = displayNameParts();
    return (
      botName() ||
      parts?.firstName ||
      propDisplayName() ||
      parts?.fullName ||
      emailLocalPart(propEmail())
    );
  });

  const tooltipDisplayName = createMemo(
    () => displayNameParts()?.fullName || mentionDisplayName()
  );

  // The live agent name is display only; the stored name stays as written.
  createEffect(() => {
    if (botId()) return;
    const nextDisplayName = mentionDisplayName().trim();
    if (!nextDisplayName || nextDisplayName === propDisplayName()) return;

    setTimeout(() => {
      host.updateUserDisplayName(userId(), nextDisplayName);
    });
  });

  return (
    <UserCardTrigger
      placement="top"
      triggerAs="span"
      user={{
        displayName: tooltipDisplayName() || email() || propEmail(),
        email: email() || propEmail(),
        id: userId(),
      }}
      trigger={
        <span
          class={cn(
            'relative p-0.5 cursor-default rounded-md bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent',
            isSelectedAsNode() && 'bg-active'
          )}
        >
          <span
            data-user-id={props.userId}
            data-email={props.email}
            data-display-name={mentionDisplayName()}
            data-user-mention="true"
          >
            @{mentionDisplayName()}
          </span>
        </span>
      }
    />
  );
}
