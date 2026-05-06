import { cn } from '@ui/utils/classname';
import type { UserMentionDecoratorProps } from '@lexical-core';
import { createMemo, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { Tooltip } from '@core/component/Tooltip';
import { UserTooltip } from '@core/component/UserTooltip';
import { tryMacroId, macroIdToEmail, useDisplayName } from '@core/user';

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

  const macroId = createMemo(() =>
    props.userId ? tryMacroId(userId()) : undefined
  );

  const [displayName] = useDisplayName(macroId());

  const email = createMemo(() => {
    const id = macroId();
    if (id) return macroIdToEmail(id);
    return propEmail();
  });

  return (
    <Tooltip
      placement="top"
      unstyled
      tooltip={(close) => (
        <UserTooltip
          displayName={displayName() || email() || propEmail()}
          email={email() || propEmail()}
          id={userId()}
          onClose={close}
        />
      )}
    >
      <span
        class={cn(
          'relative py-0.5 px-0.5 cursor-default rounded-xs bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent-ink',
          isSelectedAsNode() && 'bg-active'
        )}
      >
        <span
          data-user-id={props.userId}
          data-email={props.email}
          data-user-mention="true"
        >
          @{propEmail().split('@')[0]}
        </span>
      </span>
    </Tooltip>
  );
}
