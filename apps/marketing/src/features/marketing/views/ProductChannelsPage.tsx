import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeatureComparisons } from '../components/comparisons/FeatureComparisons';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { FeaturePhoneScreens } from '../components/FeatureScreenshot';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { chatComparisons } from '../core/feature-comparisons';
import { featureScreens, phoneScreens } from '../core/feature-screens';

export function RouteChannels() {
  setPageSeo({
    title: 'Macro Chat — Focused team chat',
    description:
      'Macro channels are filed into Signal or Noise with an actual inbox like email. Mention work to share it with the channel or create tasks from the conversation.',
    path: '/channels',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Chat"
        title="Chat for people and agents."
        description="Chat puts your teammates and AI agents in the same channels and DMs with inline threads, Signal and Noise filtering, and workspace mentions."
        cta="channels_hero_get_started"
        tutorial="chat"
      />
      <FeaturePageSection
        id="shared-work"
        title="Integrated with everything else."
        description="Channels are already where work happens. Mention Macro Mail, Macro Docs, or Macro Tasks right in the thread. Turn any message into a task or bring in Macro Agents without leaving the conversation."
        screen={featureScreens['shared-work']}
      />
      <FeaturePageSection
        id="channel-access"
        title="@mention to share with the right people."
        description="Anything you @mention in a channel is automatically shared with its members. Join a channel, gain access; leave, lose it. No permission-request dance."
        screen={featureScreens['channel-access']}
      />
      <FeaturePageSection
        id="channel-agents"
        title="Macro Agents are first-class like humans."
        description="Tag Macro Agents in a thread and they read the full conversation plus every linked file, email, and task. You can also let them chime in automatically when they can help."
        screen={featureScreens['channel-agents']}
      />
      <FeaturePageSection
        id="channel-threads"
        title="Built for focused technical conversations."
        description="The first few replies show up inline and the rest tuck cleanly into a thread. It reads like a structured forum and feels as fast as iMessage without Slack’s buried sidebars."
        screen={featureScreens['channel-threads']}
      />
      <FeaturePageSection
        id="chat-inbox"
        title="A real inbox like Macro Mail."
        description="Slack has no real inbox, only read and unread. Macro keeps messages waiting for later so you don’t have to remember to reply and you mark them done as you go. Mark a channel as Signal or Noise to decide what reaches your main inbox."
        screen={featureScreens['chat-inbox']}
      />
      <FeaturePhoneScreens screens={phoneScreens['channels']} product="Chat" />
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
            a: 'Create a channel and invite people by name or email. Choose a team channel for conversations teammates can discover or a private channel for invited people only.',
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
                replies but does not let recipients send from your mailbox. See{' '}
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
