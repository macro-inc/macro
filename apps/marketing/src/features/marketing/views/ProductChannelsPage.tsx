import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  ChannelAgentDemo,
  ChannelSharedWorkDemo,
  ChannelThreadDemo,
  ChatInboxDemo,
} from '../components/channels/ChannelStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  ContextGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../components/product/ProductPage';
import { TaskAgentsGraphic } from '../components/tasks/TasksFeatureGraphics';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';

export function RouteChannels() {
  setPageSeo({
    title: 'Macro Chat — Team Chat Wired into Your Docs, Tasks, and Email',
    description:
      'Team chat where @mentioning a doc shares it with the channel, messages wait in a real inbox until you’re done, threads stay readable, and agents can answer in the conversation.',
    path: '/channels',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Chat"
        title={['Team chat, wired into', 'everything else.']}
        description={[
          '@mention a doc, task, or email and the whole channel can open it.',
          'Plus a real inbox, so nothing slips through.',
        ]}
        cta="channels_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="messages"
        label="Explore Macro Chat"
        caption="A sample workspace. Open a thread, click a linked doc, or send a message."
      />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#shared-work">
          <LinkedWorkGraphic />
          <span>Share by mention</span>
        </a>
        <a href="#chat-inbox">
          <ContextGraphic />
          <span>A real inbox</span>
        </a>
        <a href="#channel-threads">
          <ThreadGraphic />
          <span>Inline threads</span>
        </a>
        <a href="#channel-agents">
          <TaskAgentsGraphic />
          <span>Agents in channels</span>
        </a>
      </nav>
      <FeaturePageSection
        id="shared-work"
        title="@mention it and it’s shared."
        description={
          'Mention a doc, task, or email thread and everyone in the channel can open it.\nJoin the channel and you have access. No access requests.'
        }
      >
        <div class="feature-page-visual">
          <ChannelSharedWorkDemo />
        </div>
        <ProductProse>
          <p>
            Channels are already where your company runs, whether that’s Slack
            or a group text. The problem is everything else lives somewhere
            else. In Macro, anything you @mention in a channel is shared with
            the people in it, so you never spend the afternoon approving access
            requests. New hires join #launch and can open everything that’s been
            linked there. Links go both ways, too: the doc shows every
            conversation it came up in, and any message can become a task with
            one click.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="chat-inbox"
        title="Chat with an actual inbox."
        description={
          'Messages land in Home next to your email and tasks. Press E when you’re done.\nAnything you haven’t dealt with stays put, so you can leave it for later.'
        }
      >
        <div class="feature-page-visual">
          <ChatInboxDemo />
        </div>
        <ProductProse>
          <p>
            Slack only knows read and unread. Once you’ve glanced at a message,
            it’s gone, and you have to remember to come back to it. Macro treats
            chat like email: mentions, threads you’re in, and DMs land in Home
            next to your email, tasks, and pull requests. Reading something
            doesn’t clear it. Marking it done does. You can answer things when
            you’re ready instead of the second they arrive, and without the
            low-grade anxiety of a dozen unread badges.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-threads"
        title="Threads you can actually follow."
        description={
          'The first replies show right under the message.\nNo side panel, and no hunting for the reply someone said they left.'
        }
      >
        <div class="feature-page-visual">
          <ChannelThreadDemo />
        </div>
        <ProductProse>
          <p>
            We tried every way of doing threads. Slack’s side panel keeps the
            channel tidy but hides the conversation. iMessage and Discord are
            fine for banter and painful for anything technical. Reddit-style
            nesting turns into a forum. We landed on showing the first few
            replies inline, connected to the message they answer, with a pill
            for the rest. It’s the happy medium that’s worked best for our own
            team.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-agents"
        title="Agents are in the channel too."
        description={
          '@mention Macro, Claude, or Cursor like anyone else.\nThey read the conversation, and their answers stay where the team can see them.'
        }
      >
        <div class="feature-page-visual">
          <ChannelAgentDemo />
        </div>
        <ProductProse>
          <p>
            Asking an agent in the channel beats pasting the conversation into
            ChatGPT. It already has the thread and everything linked in it, so
            you don’t have to explain. Ask @Macro to catch you up, turn a
            discussion into tasks, or draft the customer email. Hand a bug to
            Claude or Cursor and they come back with a pull request. Either way,
            the answer lands in the channel, so the rest of the team knows what
            happened.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="channels-faq-title"
        title="Questions about Macro Chat"
        introduction={
          <p>
            If your team lives in Slack, most of this will feel familiar. Here’s
            what’s different.
          </p>
        }
        items={[
          {
            q: 'How is this different from Slack?',
            a: 'Three things. Anything you @mention in a channel is shared with it, so there are no access requests. Messages wait in a real inbox you can clear, instead of a wall of unread badges. And channels are connected to your docs, tasks, email, and calls, so the conversation and the work stay together.',
          },
          {
            q: 'Can I share docs and email in a channel?',
            a: (
              <>
                Yes. @mention a doc or task, or share an email thread from your
                inbox. Everyone in the channel can open it, and shared email
                threads keep updating when new replies come in. See{' '}
                <a href="/email">email sharing</a>.
              </>
            ),
          },
          {
            q: 'Can a message become a task?',
            a: (
              <>
                Yes. Hover the message and click Task, or ask @Macro to make
                tasks for you. See <a href="/tasks">Macro Tasks</a>.
              </>
            ),
          },
          {
            q: 'Can I quiet a noisy channel?',
            a: 'Yes. Mute or snooze notifications for any channel from its menu.',
          },
          {
            q: 'Which agents can I mention?',
            a: (
              <>
                Macro’s own agent, plus coding agents like Claude and Cursor.
                See <a href="/agents">agents in Macro</a>.
              </>
            ),
          },
          {
            q: 'Will these examples post to my account?',
            a: 'No. Everything on this page is a local sample. Nothing you type here leaves your browser.',
          },
          {
            q: 'Is there a free plan?',
            a: (
              <>
                Yes. See <a href="/pricing">pricing</a> for current plans and
                limits.
              </>
            ),
          },
        ]}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
