import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  ChannelAgentDemo,
  ChannelHero,
  ChannelPermissionsDemo,
  ChannelSharedWorkDemo,
  ChannelThreadDemo,
} from '../components/channels/ChannelStories';
import { FeatureComparisons } from '../components/comparisons/FeatureComparisons';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  ContextGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { TaskAgentsGraphic } from '../components/tasks/TasksFeatureGraphics';
import { chatComparisons } from '../core/feature-comparisons';

export function RouteChannels() {
  setPageSeo({
    title: 'Macro Chat: Bring the Work into the Conversation',
    description:
      'Share documents, tasks, and email threads in team chat. Channel members get access, work stays linked to its discussion, and follow-ups wait in one inbox.',
    path: '/channels',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Chat"
        title={['Team chat connected to', 'the rest of your work.']}
        description={[
          'Your team already works through conversations.',
          'The rest of the software should keep up.',
        ]}
        cta="channels_hero_get_started"
      />
      <ChannelHero />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#shared-work">
          <LinkedWorkGraphic />
          <span>Open the work</span>
        </a>
        <a href="#channel-access">
          <ContextGraphic />
          <span>Channel access</span>
        </a>
        <a href="#channel-agents">
          <TaskAgentsGraphic />
          <span>Agents</span>
        </a>
        <a href="#catch-up">
          <ThreadGraphic />
          <span>Catch up</span>
        </a>
      </nav>
      <FeaturePageSection
        id="shared-work"
        title={['Open all your work', 'straight from chat.']}
        description="Mention a document, email, task, or customer and open it beside the conversation. Create a task from a message when something needs doing. Both the task and the message link back to each other, so the reason for the work stays with it."
      >
        <DemoInteractionBoundary
          class="feature-page-visual channel-wide-demo"
          render={() => <ChannelSharedWorkDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-access"
        title={['Share it in the channel.', 'The channel gets access.']}
        description="Nobody should have to ask for access to a file you just sent them. Channel members get access to the work shared there. Join the channel and gain that access; leave and lose the access it granted."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <ChannelPermissionsDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-agents"
        title={['Bring your agents', 'into the conversation.']}
        description="Mention an agent the way you’d mention a colleague. Ask it to answer a question, update the plan, or create tasks from the discussion. Use Macro’s agent or bring your own, with the conversation already there as context."
      >
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <ChannelAgentDemo />}
        />
      </FeaturePageSection>
      <FeaturePageSection
        id="catch-up"
        title={['Read the thread.', 'Reply when you’re ready.']}
        description="We wanted chat that was easier to keep up with. Replies appear inline, and messages wait in an actual inbox until you mark them done. Put the channels that matter in Signal and the rest in Noise. Read doesn’t have to mean dealt with."
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
                See <a href="/migrate">migration options</a> for supported
                imports and what carries over. Importing conversation history is
                separate from keeping another app in sync.
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
            a: 'Team channels are discoverable by the team; private channels are limited to invited members. New members can read the channel’s history. Sharing files in a channel gives members access, so check membership before sharing sensitive work.',
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
                <a href="/pricing">plans and limits</a> before choosing a plan
                for your team.
              </>
            ),
          },
        ]}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
