import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { useEmail } from '@core/context/user';
import { emailToMacroId } from '@core/user';
import { createMemo, For } from 'solid-js';
import { useEmailContext } from './EmailContext';
import { EmailUserTooltip } from './EmailUserTooltip';

interface Participant {
  email: string;
  name?: string;
}

export function EmailParticipants() {
  const context = useEmailContext();
  const currentUserEmail = useEmail();

  const participants = createMemo(() => {
    const messages = context.messages.unfiltered();
    const seen = new Map<string, Participant>();

    for (const m of messages) {
      if (m.from?.email) {
        const existing = seen.get(m.from.email);
        if (!existing || (!existing.name && m.from.name)) {
          seen.set(m.from.email, {
            email: m.from.email,
            name: m.from.name ?? undefined,
          });
        }
      }
      for (const r of [...m.to, ...m.cc]) {
        if (!r.email) continue;
        const existing = seen.get(r.email);
        if (!existing || (!existing.name && r.name)) {
          seen.set(r.email, {
            email: r.email,
            name: r.name ?? undefined,
          });
        }
      }
    }

    return Array.from(seen.values());
  });

  const getDisplayName = (p: Participant) => {
    if (p.email === currentUserEmail()) return 'Me';
    if (p.name) return p.name.split(' ')[0];
    return p.email.split('@')[0];
  };

  const getIconProps = (p: Participant): UserIconProps => {
    const macroId = emailToMacroId(p.email);
    if (macroId) return { id: macroId };
    return { email: p.email };
  };

  return (
    <div class="flex flex-wrap gap-1.5" role="list">
      <For each={participants()}>
        {(participant) => (
          <EmailUserTooltip
            recipient={{ email: participant.email, name: participant.name }}
          >
            <div
              role="listitem"
              class="inline-flex items-center gap-1.5 rounded-full border border-ink-muted/8 bg-ink-muted/[0.025] py-1 pr-2.5 pl-1 text-sm text-ink hover:bg-ink-muted/[0.06] cursor-default"
            >
              <UserIcon
                {...getIconProps(participant)}
                isDeleted={false}
                size="sm"
                suppressClick
              />
              <span class="truncate max-w-32">
                {getDisplayName(participant)}
              </span>
            </div>
          </EmailUserTooltip>
        )}
      </For>
    </div>
  );
}
