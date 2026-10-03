import { createMentionsTracker } from '@app/features/channel/Input/mentions-tracker';
import { authoredMentions } from '@app/features/channel/Input/message-payload';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { SERVER_HOSTS } from '@core/constant/servers';
import { useUserId } from '@core/context/user';
import { useIsTeamAdmin } from '@queries/team/teams';
import type { Presentation } from './context/contracts';
import { createWorkspace } from './queries/workspace';
import { SupportWorkspace } from './views/workspace';
export function Support(props: {
  initialTicket?: string;
  companyId?: string;
  contactId?: string;
}) {
  const user = useUserId();
  const layout = useSplitLayout();
  const canConfigure = useIsTeamAdmin();
  const presentation: Presentation = {
    userId: user() ?? '',
    canConfigure,
    apiBase: SERVER_HOSTS['document-storage-service'].replace(/\/$/, ''),
    Markdown: (props) => <StaticMarkdown markdown={props.content} />,
    Editor: (props) => {
      const tracker = createMentionsTracker();
      return (
        <MarkdownTextarea
          editable={() => true}
          initialValue={props.value}
          placeholder="Write a reply…"
          floatingFormatMenu
          onChange={(value) =>
            props.onChange(value, authoredMentions(tracker.mentions()))
          }
          onUserMention={(mention) =>
            mention.mentions.forEach((itemId) =>
              tracker.onMentionCreate({ itemId, itemType: 'user' })
            )
          }
          onDocumentMention={(mention) =>
            tracker.onMentionCreate({
              itemId: mention.id,
              itemType: mention.type === 'project' ? 'project' : 'document',
            })
          }
          onRemoveMention={tracker.onMentionRemove}
        />
      );
    },
    openTask: (id) => layout.openWithSplit({ type: 'md', id }),
    openChannel: (id) => layout.openWithSplit({ type: 'channel', id }),
    openCompany: (id) => layout.openWithSplit({ type: 'company', id }),
  };
  return (
    <SupportWorkspace
      workspace={createWorkspace({
        ticket: props.initialTicket,
        companyId: props.companyId,
        contactId: props.contactId,
      })}
      presentation={presentation}
    />
  );
}
