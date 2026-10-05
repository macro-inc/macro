import { EmailUserTooltip } from '@app/features/email-message/components/email-user-tooltip';
import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { emailToMacroId } from '@core/user/macroId';
import { Key } from '@solid-primitives/keyed';
import { Badge, Button, badgeTriggerClasses } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { useEmailThreadViewContext } from '../context/email-thread-view-context';

interface Participant {
  email: string;
  name?: string;
  photoUrl?: string;
}

const DEFAULT_VISIBLE_COUNT = 5;

export function EmailParticipants() {
  const context = useEmailThreadState();
  const viewContext = useEmailThreadViewContext();
  const currentUserEmail = viewContext.thread.viewerEmail;
  const [expanded, setExpanded] = createSignal(false);

  const participants = createMemo(() => {
    // Unsent drafts can be prepended optimistically and removed when emptied.
    // Participants describe the conversation, not the current draft envelope.
    const messages = context.messages.list();
    const seen = new Map<string, Participant>();

    for (const m of messages) {
      if (m.from?.email) {
        const existing = seen.get(m.from.email);
        if (!existing || (!existing.name && m.from.name)) {
          seen.set(m.from.email, {
            email: m.from.email,
            name: m.from.name ?? undefined,
            photoUrl: m.from.photo_url ?? existing?.photoUrl ?? undefined,
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
            photoUrl: r.photo_url ?? existing?.photoUrl ?? undefined,
          });
        }
      }
    }

    return Array.from(seen.values());
  });

  const visibleParticipants = createMemo(() => {
    const all = participants();
    if (expanded() || all.length <= DEFAULT_VISIBLE_COUNT) return all;
    return all.slice(0, DEFAULT_VISIBLE_COUNT);
  });

  const hiddenCount = createMemo(() =>
    Math.max(0, participants().length - DEFAULT_VISIBLE_COUNT)
  );

  const getDisplayName = (p: Participant) => {
    if (p.email === currentUserEmail()) return 'Me';
    if (p.name) return p.name.split(' ')[0];
    return p.email.split('@')[0];
  };

  const getIconProps = (p: Participant): UserIconProps => {
    const macroId = emailToMacroId(p.email);
    if (macroId) return { id: macroId, photoUrl: p.photoUrl };
    return { email: p.email, photoUrl: p.photoUrl };
  };

  return (
    <div class="flex flex-wrap items-center gap-2" role="list">
      <Show
        when={context.permissions().isOwner && viewContext.rendering.renderTags}
      >
        {(renderTags) => (
          <div role="listitem" class="inline-flex">
            {renderTags()()}
          </div>
        )}
      </Show>
      <Key each={visibleParticipants()} by="email">
        {(participant) => (
          <EmailUserTooltip
            recipient={{ email: participant().email, name: participant().name }}
            photoUrl={participant().photoUrl}
          >
            <Badge
              role="listitem"
              variant="outline"
              size="sm"
              class="gap-1.5 bg-surface-2 border-edge"
            >
              <UserIcon
                {...getIconProps(participant())}
                isDeleted={false}
                size="sm"
                suppressClick
                showTooltip={false}
              />
              <span class="truncate max-w-32">
                {getDisplayName(participant())}
              </span>
            </Badge>
          </EmailUserTooltip>
        )}
      </Key>
      <Show when={hiddenCount() > 0}>
        <Button
          variant="outline"
          size="sm"
          noTouchResize
          onClick={() => setExpanded((v) => !v)}
          class={badgeTriggerClasses({
            variant: 'outline',
            size: 'sm',
            class: 'bg-surface-2 border-edge tabular-nums',
          })}
        >
          {expanded() ? 'Show less' : `+${hiddenCount()} more`}
        </Button>
      </Show>
    </div>
  );
}
