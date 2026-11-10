import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  ChannelPermissionsDemo,
  ChannelThreadDemo,
} from '../components/channels/ChannelStories';
import { FeatureComparisons } from '../components/comparisons/FeatureComparisons';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { PaperChatCall } from '../components/paper/PaperChatCall';
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
        tutorial="chat"
        product="Chat"
        title="Chat for people and agents."
        description="Macro Chat brings your people and agents together in channels. Share context and work on the same tasks."
        cta="channels_hero_get_started"
      />
      <FeaturePageSection
        id="shared-work"
        title="Share emails, docs, and tasks in chat."
        description="@mention an email, doc, or task to share it with the channel. Create a task from a message without leaving the conversation."
      >
        <PaperFeatureGraphic label="Create a task, share a document, or ask Macro from the channel composer.">
          <PaperChatCreate />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-access"
        demo={{
          tone: 'chat',
          message: {
            person: 'jacob',
            text: 'Shared with the channel — everyone here can open it.',
          },
        }}
        title="Share access with channel members."
        description="Anything you @mention in a channel is automatically shared with its members. Join a channel, gain access; leave, lose it."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <ChannelPermissionsDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-agents"
        title="Bring Macro Agents into the conversation."
        description="Mention the Macro Agent and ask it to create tasks or update a document from the conversation."
      >
        <PaperFeatureGraphic label="Ask Macro in a channel and see its completed work in the conversation.">
          <PaperChatCall />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="catch-up"
        demo={{
          tone: 'chat',
          message: {
            person: 'jacob',
            text: 'I’ll reply in the thread.',
          },
        }}
        title="Mark conversations done as you go."
        description="Keep messages waiting in your inbox until you’re ready to reply, then mark them done. The first couple of replies show inline, so you don’t have to open a side panel to read every thread."
      >
        <span id="channel-threads" />
        <span id="chat-inbox" />
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <ChannelThreadDemo />}
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
