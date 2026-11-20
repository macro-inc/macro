import { type Component, lazy } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  DeferredDemo,
  DemoPlaceholder,
} from '../../features/marketing/components/DeferredDemo';
import {
  FeatureDemoArt,
  type FeatureDemoComposition,
} from '../../features/marketing/components/FeatureDemoArt';
import './post-product-graphic.css';

// Share the feature-page scenes. Load them near the reader, not all at page load.
const scenes = {
  'email-thread': {
    tone: 'email',
    label: 'Read and reply to email',
    load: () =>
      import('./PostWorkspaceScenes').then((m) => ({
        default: m.PostEmailThread,
      })),
  },
  'task-email': {
    tone: 'tasks',
    label: 'An email and its follow-up task',
    load: () =>
      import('./PostTaskScenes').then((m) => ({ default: m.PostEmailTask })),
  },
  'task-composer': {
    tone: 'tasks',
    label: 'Create a task with its owner and priority',
    load: () =>
      import('./PostTaskScenes').then((m) => ({ default: m.PostTaskComposer })),
  },
  'task-create': {
    tone: 'tasks',
    label: 'Create a task from a message',
    load: () =>
      import('../../features/marketing/components/tasks/TaskStories').then(
        (m) => ({ default: m.TaskFromMessageDemo })
      ),
  },
  'task-context': {
    tone: 'tasks',
    label: 'A task and its linked context',
    load: () =>
      import('../../features/marketing/components/tasks/TaskContextDemo').then(
        (m) => ({ default: m.TaskContextDemo })
      ),
  },
  'task-agent': {
    tone: 'tasks',
    label: 'Create and assign tasks in a channel',
    load: () =>
      import('../../features/marketing/components/tasks/TaskStories').then(
        (m) => ({ default: m.TaskAgentChannelDemo })
      ),
  },
  'task-github': {
    tone: 'github',
    label: 'A task linked to its pull request',
    load: () =>
      import('../../features/marketing/components/tasks/TaskStories').then(
        (m) => ({ default: m.TaskGithubDemo })
      ),
  },
  'chat-splits': {
    tone: 'chat',
    label: 'Channels open side by side',
    load: () =>
      import('./PostWorkspaceScenes').then((m) => ({
        default: m.PostChatSplits,
      })),
  },
  threads: {
    tone: 'chat',
    label: 'Read and reply to channel threads',
    load: () =>
      import(
        '../../features/marketing/components/channels/ChannelStories'
      ).then((m) => ({ default: m.ChannelThreadDemo })),
  },
  document: {
    tone: 'documents',
    label: 'Edit a shared document',
    load: () =>
      import(
        '../../features/marketing/components/documents/DocumentProjectDemo'
      ).then((m) => ({ default: m.DocumentProjectDemo })),
  },
  'doc-agent': {
    tone: 'documents',
    label: 'An agent editing a shared document',
    load: () =>
      import(
        '../../features/marketing/components/documents/DocumentStories'
      ).then((m) => ({ default: m.DocumentAgentDemo })),
  },
  'doc-mentions': {
    tone: 'documents',
    label: 'Open linked work beside a document',
    load: () =>
      import(
        '../../features/marketing/components/documents/DocumentMentionsDemo'
      ).then((m) => ({ default: m.DocumentMentionsDemo })),
  },
  'doc-sharing': {
    tone: 'documents',
    label: 'Share a document with a channel',
    load: () =>
      import(
        '../../features/marketing/components/documents/DocumentSharingDemo'
      ).then((m) => ({ default: m.DocumentSharingDemo })),
  },
  'email-accounts': {
    tone: 'email',
    label: 'Email accounts in one inbox',
    load: () =>
      import(
        '../../features/marketing/components/email/EmailAccountsDemo'
      ).then((m) => ({ default: m.EmailAccountsDemo })),
  },
  'email-signal': {
    tone: 'email',
    label: 'Signal and Noise in Macro Mail',
    load: () =>
      import('../../features/marketing/components/email/EmailInboxDemo').then(
        (m) => ({ default: m.EmailSignalNoiseDemo })
      ),
  },
  'email-agent': {
    tone: 'email',
    label: 'Draft email with an agent',
    load: () =>
      import(
        '../../features/marketing/components/email/EmailAgenticEditingDemo'
      ).then((m) => ({ default: m.EmailAgenticEditingDemo })),
  },
  'email-sharing': {
    tone: 'email',
    label: 'An email shared into a channel',
    load: () =>
      import('../../features/marketing/components/email/EmailSharingDemo').then(
        (m) => ({ default: m.EmailSharingDemo })
      ),
  },
  'email-splits': {
    tone: 'email',
    label: 'Read and compose email in Macro',
    load: () =>
      import('./PostWorkspaceScenes').then((m) => ({
        default: m.PostEmailSplits,
      })),
  },
  crm: {
    tone: 'crm',
    label: 'Customer work in one CRM record',
    load: () =>
      import('../../features/marketing/components/crm/CrmRecordDemo').then(
        (m) => ({ default: m.CrmRecordDemo })
      ),
  },
  call: {
    tone: 'calls',
    label: 'Turn a call into follow-up tasks',
    load: () =>
      import('../../features/marketing/components/calls/CallStories').then(
        (m) => ({ default: m.CallFollowupDemo })
      ),
  },
  'agent-team': {
    tone: 'agents',
    label: 'Work with agents in a channel',
    load: () =>
      import(
        '../../features/marketing/components/agents/AgentWorkflowStories'
      ).then((m) => ({ default: m.AgentTeamworkStory })),
  },
  inbox: {
    tone: 'email',
    label: 'Email, channels and tasks in one inbox',
    load: () =>
      import('./PostContextScenes').then((m) => ({ default: m.PostInbox })),
  },
  tags: {
    tone: 'documents',
    label: 'Find work by its shared tags',
    load: () =>
      import('./PostContextScenes').then((m) => ({ default: m.PostTags })),
  },
  'agent-context': {
    tone: 'agents',
    label: 'An agent reads channel context',
    load: () =>
      import('./PostContextScenes').then((m) => ({
        default: m.PostAgentContext,
      })),
  },
  'agent-mentions': {
    tone: 'agents',
    label: 'Give an agent context with mentions',
    load: () =>
      import('./PostContextScenes').then((m) => ({
        default: m.PostAgentMentions,
      })),
  },
} satisfies Record<
  string,
  {
    tone: FeatureDemoComposition['tone'];
    label: string;
    load: () => Promise<{ default: Component }>;
  }
>;

export type PostGraphicKind = keyof typeof scenes;

/** Inline, local product UI; the surrounding article retains its reading measure. */
export function PostProductGraphic(props: { kind: PostGraphicKind }) {
  const scene = scenes[props.kind];
  const Demo = lazy(scene.load);
  return (
    <figure
      class="post-product-graphic"
      aria-label={scene.label}
      data-scene={props.kind}
    >
      <div class="post-product-ui feature-page">
        <div class="product-page">
          <DeferredDemo
            preload={scene.load}
            fallback={<DemoPlaceholder label={scene.label} />}
          >
            <FeatureDemoArt composition={{ tone: scene.tone }}>
              <Dynamic component={Demo} />
            </FeatureDemoArt>
          </DeferredDemo>
        </div>
      </div>
    </figure>
  );
}
