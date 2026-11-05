/** Who published a version: the person, and the agent that did it for them. */
import { parseOwner } from '@app/features/entity/owner/owner';
import { useBotName } from '@app/features/entity/owner/owner-display';
import { t } from '@app/lib/i18n';
import { getDisplayName, tryMacroId } from '@core/user';
import type { Accessor } from 'solid-js';

export type Publisher = {
  created_by: string;
  created_by_agent?: string | null;
};

/** "Ava Chen", or "Macro for Ava Chen" when an agent published. */
export function usePublisherName(
  publisher: Accessor<Publisher | undefined>
): Accessor<string> {
  const botId = () => {
    const owner = parseOwner(publisher()?.created_by_agent ?? undefined);
    return owner?.kind === 'bot' ? owner.botId : '';
  };
  const agent = useBotName(botId);
  return () => {
    const version = publisher();
    if (!version) return '';
    const user = getDisplayName(tryMacroId(version.created_by));
    const agentName = botId() ? agent() : '';
    return agentName
      ? t('artifacts.agentForUser', { agent: agentName, user })
      : user;
  };
}

export function PublisherName(props: { publisher: Publisher }) {
  const name = usePublisherName(() => props.publisher);
  return <>{name()}</>;
}
