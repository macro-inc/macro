import { HoverCard } from '@core/component/HoverCard';
import { UserTooltip } from '@core/component/UserTooltip';
import { getDisplayNameParts, macroIdToEmail, tryMacroId } from '@core/user';
import type { UserMentionDecoratorProps } from '@macro-inc/lexical-core';
import { cn } from '@ui';
import { createEffect, createMemo, createSignal, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { UPDATE_USER_DISPLAY_NAME_COMMAND } from '../../plugins';

function emailLocalPart(email: string): string {
  return email.split('@')[0] || email;
}

export function UserMention(props: UserMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  // Convert String wrapper to primitive string
  const userId = () => String(props.userId);
  const propEmail = () => String(props.email);
  const propDisplayName = () => props.displayName?.trim() ?? '';

  const macroId = createMemo(() =>
    props.userId ? tryMacroId(userId()) : undefined
  );

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
      parts?.firstName ||
      propDisplayName() ||
      parts?.fullName ||
      emailLocalPart(propEmail())
    );
  });

  const tooltipDisplayName = createMemo(
    () => displayNameParts()?.fullName || mentionDisplayName()
  );

  createEffect(() => {
    const nextDisplayName = mentionDisplayName().trim();
    if (!nextDisplayName || nextDisplayName === propDisplayName()) return;

    setTimeout(() => {
      lexicalWrapper?.editor?.dispatchCommand(
        UPDATE_USER_DISPLAY_NAME_COMMAND,
        {
          [userId()]: nextDisplayName,
        }
      );
    });
  });

  const [open, setOpen] = createSignal(false);

  return (
    <HoverCard
      placement="top"
      open={open()}
      onOpenChange={setOpen}
      triggerAs="span"
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
      content={
        <UserTooltip
          displayName={tooltipDisplayName() || email() || propEmail()}
          email={email() || propEmail()}
          id={userId()}
          onClose={() => setOpen(false)}
        />
      }
    />
  );
}
