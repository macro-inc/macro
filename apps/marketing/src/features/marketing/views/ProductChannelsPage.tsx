import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  ChannelAgentDemo,
  ChannelHero,
  ChannelPermissionsDemo,
  ChannelSharedWorkDemo,
  ChannelThreadDemo,
} from '../components/channels/ChannelStories';
import { FeatureComparisons } from '../components/comparisons/FeatureComparisons';
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
        title={['Team chat, wired into', 'everything else.']}
        description={[
          '@mention a doc, task, person, or company',
          'and the whole channel can open it natively.',
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
        title="Open docs, tasks, and email straight from chat."
        description="Click a mention to open the work beside the conversation."
      >
        <div class="feature-page-visual channel-wide-demo">
          <ChannelSharedWorkDemo />
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-access"
        title="Access follows the channel."
        description="Mention a doc, task, or email to give the channel access. New members get access too."
      >
        <div class="feature-page-visual">
          <ChannelPermissionsDemo />
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="channel-agents"
        title="Agents are first-class participants."
        description="Use Macro’s agents or bring your own. The team can follow the work in the channel."
      >
        <div class="feature-page-visual">
          <ChannelAgentDemo />
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="catch-up"
        title="Catch up without opening every thread."
        description="Read replies inline and respond in the same conversation."
      >
        <span id="channel-threads" />
        <span id="chat-inbox" />
        <div class="feature-page-visual">
          <ChannelThreadDemo />
        </div>
      </FeaturePageSection>
      <FeatureComparisons comparisons={chatComparisons} />
      <FeaturePageFaq
        id="channels-faq-title"
        title="FAQ"
        items={[
          {
            q: 'What happens when I share an email?',
            a: (
              <>
                The channel can read the full thread, including new replies. See{' '}
                <a href="/email">email sharing</a>.
              </>
            ),
          },
          {
            q: 'Can a message become a task?',
            a: (
              <>
                Yes. Use a message’s Task action, or ask an agent to create one.
                See <a href="/tasks">Macro Tasks</a>.
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
                Macro’s agents, or agents you connect to your workspace. See how
                to <a href="/agents">bring your own agent</a>.
              </>
            ),
          },
          {
            q: 'How do we get started?',
            a: (
              <>
                Create a channel and invite your team by email. Bringing work
                over from another app? See{' '}
                <a href="/migrate">how to move to Macro</a>.
              </>
            ),
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
