import GuideWorkspaceGraphic from '../../features/documentation/components/GuideWorkspaceGraphic';
import { DocMention } from '../../features/marketing/components/documents/DocMention';
import { DocMentionMenu } from '../../features/marketing/components/documents/DocMentionMenu';
import { HomepageConversation } from '../../features/marketing/components/HomepageConversation';
import '../../features/documentation/components/guide-graphic.css';
import '../../features/marketing/components/homepage/homepage-product-preview.css';

export function PostInbox() {
  return (
    <div class="guide-graphic">
      <GuideWorkspaceGraphic
        kind="inbox"
        label="Email, channels, tasks and documents in Home"
      />
    </div>
  );
}

export function PostTags() {
  return (
    <div class="guide-graphic">
      <GuideWorkspaceGraphic
        kind="tags"
        label="A shared Launch tag across documents, email and tasks"
      />
    </div>
  );
}

/** A sample conversation, using the same bubbles and mention pills as the homepage. */
export function PostAgentContext() {
  return (
    <div class="post-agent-scene glass workspace-demo">
      <div class="post-scene-label">Macro · Team update</div>
      <HomepageConversation
        messages={[
          {
            person: 'jacob',
            text: 'What did we ship today? Read the engineering and bug reports channels.',
          },
          {
            person: 'macro',
            text: (
              <>
                Read recent messages in{' '}
                <DocMention item={{ kind: 'channel', label: 'Engineering' }} />{' '}
                and{' '}
                <DocMention item={{ kind: 'channel', label: 'Bug reports' }} />.
              </>
            ),
          },
          {
            person: 'macro',
            text: (
              <>
                The invite fix shipped. Julia checked mobile and Teo merged the
                pull request. The remaining follow-up is{' '}
                <DocMention
                  item={{ kind: 'task', label: 'Check expired invite links' }}
                />
                .
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

export function PostAgentMentions() {
  return (
    <div class="post-agent-scene glass workspace-demo">
      <div class="post-scene-label">Macro · Add context</div>
      <HomepageConversation
        messages={[
          {
            person: 'jacob',
            text: (
              <>
                Summarize the discussion in{' '}
                <DocMention item={{ kind: 'channel', label: 'Engineering' }} />{' '}
                and compare it with the launch plan.
              </>
            ),
          },
        ]}
      />
      <div class="post-mention-example" aria-label="Example context picker">
        <DocMentionMenu
          selected={0}
          groups={[
            {
              label: 'Documents, Agents, & Tasks',
              rows: [
                { kind: 'document', label: 'Launch plan' },
                { kind: 'email', label: 'Thursday demo' },
              ],
            },
            {
              label: 'Channels',
              rows: [
                { kind: 'channel', label: 'Engineering' },
                { kind: 'channel', label: 'Bug reports' },
              ],
            },
          ]}
        />
      </div>
    </div>
  );
}
