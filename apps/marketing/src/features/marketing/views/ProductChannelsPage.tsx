import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  ChannelAgentDemo,
  ChannelInboxDemo,
  ChannelPermissionsDemo,
  ChannelThreadDemo,
} from '../components/channels/ChannelStories';
import { FeatureComparisons } from '../components/comparisons/FeatureComparisons';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { PaperChatCreate } from '../components/paper/PaperChatCreate';
import { PaperFeatureGraphic } from '../components/paper/PaperFeatureGraphic';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { chatComparisons } from '../core/feature-comparisons';

export function RouteChannels() {
  setPageSeo({
    title: 'Macro Chat — Focused team chat',
    description:
      'Macro channels are filed into Signal or Noise, with an actual inbox like email. Mention work to share it with the channel, or create tasks from the conversation.',
    path: '/channels',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Chat"
        title="Chat for people and agents."
        description="Macro Chat brings your people and agents together in channels. Share context and work on the same tasks."
        cta="channels_hero_get_started"
        tutorial="chat"
      />
      <FeaturePageSection
        id="shared-work"
        title="Integrated with everything else."
        description="Channels are already the lifeblood of your company. Macro makes that a feature rather than an anti-pattern: @mention an email, doc, or task, create a task right from any message, or ask Macro, without leaving the conversation."
      >
        <PaperFeatureGraphic label="Create a task, share a document, or ask Macro from the channel composer.">
          <PaperChatCreate />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-access"
        demo={{
          tone: 'chat',
        }}
        title="@mention to share with the right people."
        description="Anything you @mention in a channel is automatically shared with its members. Join a channel, gain access; leave, lose it. No permission-request dance."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <ChannelPermissionsDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-agents"
        demo={{
          tone: 'chat',
        }}
        title="Macro Agents are first-class, like humans."
        description="@mention an agent to get it working on something, with the whole conversation as context. Or let it listen in and reply when it’s needed, like a teammate would."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <ChannelAgentDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-threads"
        demo={{
          tone: 'chat',
        }}
        title="Built for focused technical conversations."
        description="The first couple of replies show inline and the rest collapse into a thread, so a busy channel stays readable. Slack’s side panel is nice for organization but can make it hard to find things; iMessage and Discord are good for casual conversations, but not deep technical ones."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <ChannelThreadDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="chat-inbox"
        demo={{
          tone: 'chat',
        }}
        title="A real inbox, like Macro Mail."
        description="Slack has no real inbox, only read and unread. Macro keeps messages waiting for later, so you don’t have to remember to reply, and you mark them done as you go. Mark a channel as Signal or Noise to decide what reaches your main inbox."
      >
        <span id="catch-up" />
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <ChannelInboxDemo />}
        />
      </FeaturePageSection>
      <FeatureComparisons
        title="Compare Team Chat Apps"
        comparisons={chatComparisons}
      />
      <FeaturePageFaq
        guide={{ href: '/channels#guide', label: 'chat' }}
        id="channels-faq-title"
        title="Questions about Macro Chat"
        items={[
          {
            q: 'How do I start a channel with my team?',
            a: 'Create a channel and invite people by name or email. Choose a team channel for conversations teammates can discover, or a private channel for invited people only.',
          },
          {
            q: 'Can I bring conversations from another app?',
            a: (
              <>
                See <a href="/docs/switch-to-macro">migration options</a> for
                supported imports and what carries over. Importing conversation
                history is separate from keeping another app in sync.
              </>
            ),
          },
          {
            q: 'Can I share emails, documents, and tasks in chat?',
            a: (
              <>
                Yes. Mention workspace items to open them beside the
                conversation. A shared email includes the thread and later
                replies, but does not let recipients send from your mailbox. See{' '}
                <a href="/email">email sharing</a>.
              </>
            ),
          },
          {
            q: 'Can agents help in a channel?',
            a: (
              <>
                Yes. Mention an available agent to answer questions, draft work,
                or create and update tasks from the conversation. See{' '}
                <a href="/agents">Macro Agents</a>.
              </>
            ),
          },
          {
            q: 'Who can see a channel and its files?',
            a: 'Your team can discover team channels; private channels are only visible to invited members. New members can read the history and open files shared with the channel.',
          },
          {
            q: 'Can I mute a busy channel?',
            a: 'Yes. Mute or snooze its notifications from the channel menu without leaving the conversation.',
          },
          {
            q: 'Can I try Macro for free?',
            a: (
              <>
                Yes. Macro has a free plan with usage limits. See{' '}
                <a href="/pricing">plans and limits</a> for details.
              </>
            ),
          },
        ]}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
