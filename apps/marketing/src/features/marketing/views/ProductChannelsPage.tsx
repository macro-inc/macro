import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  ChannelAgentDemo,
  ChannelNavigationDemo,
  ChannelSharedWorkDemo,
  ChannelTaskDemo,
  ChannelThreadDemo,
} from '../components/channels/ChannelStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../components/product/ProductPage';
import {
  TaskAgentsGraphic,
  TaskConversationGraphic,
} from '../components/tasks/TasksFeatureGraphics';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';

export function RouteChannels() {
  setPageSeo({
    title: 'Macro Chat — Team Chat Wired into Everything',
    description:
      'Macro Chat combines Slack-speed team chat with inline threads, @mention sharing, a unified inbox, and AI agents — all in one workspace with your email, docs, and tasks.',
    path: '/channels',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Chat"
        title={['Team chat for humans', 'and agents.']}
        description={[
          'Messages, emails, and tasks in one inbox.',
          '@mention a document to share it with the channel.',
        ]}
        cta="channels_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="messages"
        label="Explore Macro Chat"
        caption="Open a thread, share a linked item, or reply. Everything here stays in the sample."
      />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#shared-work">
          <LinkedWorkGraphic />
          <span>Share the work</span>
        </a>
        <a href="#conversation-tasks">
          <TaskConversationGraphic />
          <span>Act on a request</span>
        </a>
        <a href="#channel-agents">
          <TaskAgentsGraphic />
          <span>Bring in an agent</span>
        </a>
        <a href="#channel-threads">
          <ThreadGraphic />
          <span>Keep the thread</span>
        </a>
      </nav>
      <FeaturePageSection
        id="shared-work"
        title="@mention it. Share it."
        description={
          'Mention a document, task, or email thread in a channel.\nTeammates can open the item directly from the message.'
        }
      >
        <div class="feature-page-visual">
          <ChannelSharedWorkDemo />
        </div>
        <ProductProse>
          <p>
            Macro references are bidirectional. Mention a document in chat, and
            the document links back to that conversation. When you have
            permission to share the item, a channel mention grants access to the
            channel. Shared email threads keep updating as new replies arrive.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="conversation-tasks"
        title="Create a task from a message."
        description={
          'Turn a request into a task with a description, owner, and priority.\nThe task links back to the message that created it.'
        }
      >
        <div class="feature-page-visual">
          <ChannelTaskDemo />
        </div>
        <ProductProse>
          <p>
            Create a task from a channel message or ask an agent to do it. The
            source remains linked, so the assignee can read the original request
            and replies. Mention the task in another conversation and its
            current status appears in the reference. Open it to update the
            brief, assign someone, or comment.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-agents"
        title="Agents are channel participants."
        description={
          'Ask an agent in the conversation where the decision happened.\nIt can read messages, open references, and update the work.'
        }
      >
        <div class="feature-page-visual">
          <ChannelAgentDemo />
        </div>
        <ProductProse>
          <p>
            Agents can participate in channels and DMs. @mention an agent with a
            question or instruction and give it the relevant documents, tasks,
            or emails. Workspace tools let it search for an answer, edit a
            document, create a task, or prepare an email. Your team can read the
            request and continue the conversation.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-threads"
        title="Replies stay inline."
        description={
          'Expand a thread under its original message.\nRead and reply while the rest of the channel stays visible.'
        }
      >
        <div class="feature-page-visual">
          <ChannelThreadDemo />
        </div>
        <ProductProse>
          <p>
            Threads expand in the message flow, with curved rails connecting
            replies to their parent. Questions, answers, reactions, and linked
            work stay readable in order. Collapse a thread when you’re finished.
            The main conversation stays in view while you catch up or write a
            reply.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-navigation"
        title="Chat with an actual inbox."
        description={
          'Channel messages and DMs arrive alongside emails, tasks, and agent responses.\nMark an item done when you’ve dealt with it.'
        }
      >
        <div class="feature-page-visual">
          <ChannelNavigationDemo />
        </div>
        <ProductProse>
          <p>
            Read and done are separate states. Opening a message marks it read;
            marking it done clears it from your inbox. Leave it there when it
            still needs a response. Use Signal and Noise to prioritize
            conversations, and Recent to return to channels and DMs. The
            Attachments tab collects the items shared in each conversation.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="channels-faq-title"
        eyebrow="Channels, threads, and sharing"
        title="How Macro Chat works."
        introduction={
          <p>
            An inbox for conversations, inline replies, and channel access for
            shared work.
          </p>
        }
        items={[
          {
            q: 'Can I share documents and email in a channel?',
            a: (
              <>
                Yes. Share or mention a workspace item so teammates can open it
                from the conversation. Access still follows the item’s sharing
                permissions. See <a href="/email">email sharing</a>.
              </>
            ),
          },
          {
            q: 'Can a message become a task?',
            a: (
              <>
                Yes. Create a task from the message and retain the source
                conversation. The assignee can work in{' '}
                <a href="/tasks">the task view</a>.
              </>
            ),
          },
          {
            q: 'Where do replies appear?',
            a: 'Replies stay under their original message. Expand the thread to follow the discussion and reply in place.',
          },
          {
            q: 'Can agents use a channel’s context?',
            a: (
              <>
                Yes. Give an agent a clear question or job with the relevant
                workspace context. See <a href="/agents">agents in Macro</a> for
                concrete examples.
              </>
            ),
          },
          {
            q: 'Will these examples post to my account?',
            a: 'No. These demos use fictional local data. Messages, edits, and task creation never reach your account.',
          },
          {
            q: 'Can I join as a Guest for free?',
            a: (
              <>
                Yes. Guest access is free. See <a href="/pricing">pricing</a>{' '}
                for current access and limits.
              </>
            ),
          },
        ]}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
