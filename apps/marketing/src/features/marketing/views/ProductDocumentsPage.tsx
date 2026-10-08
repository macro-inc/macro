import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  DocumentAgentDemo,
  DocumentMentionsDemo,
  DocumentOfflineDemo,
  DocumentSharingDemo,
} from '../components/documents/DocumentStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  ContextGraphic,
  EditingGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../components/product/ProductPage';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';

const documentsFaq = [
  {
    q: 'How is this different from Notion?',
    a: 'Notion is a blank canvas: everything is a page or a database, and you build your own CRM or task tracker out of them. We took the opposite approach. Macro has dedicated tools for email, tasks, chat, and CRM, and docs are just docs. They’re also fast, work offline, merge edits without conflicts, and agents can edit them live.',
  },
  {
    q: 'Can an agent edit my doc directly?',
    a: (
      <>
        Yes. Agents edit native Macro docs in place, with their own cursor, even
        when the doc is closed. PDFs and other uploads can be read, but not
        edited. See <a href="/agents">agents in Macro</a>.
      </>
    ),
  },
  {
    q: 'Can I edit offline?',
    a: 'Yes. Edits save on your device and sync when you reconnect. If someone else changed the doc in the meantime, both sets of edits merge.',
  },
  {
    q: 'What can I @mention?',
    a: 'People, docs, tasks, channels, emails, customers, and dates. Mentions of docs, tasks, and emails link both ways, so the other item lists the doc in its References.',
  },
  {
    q: 'Who can see my doc?',
    a: 'Anyone you share it with, plus everyone in a channel where it’s been mentioned. You can set edit, comment, or view access per person.',
  },
  {
    q: 'Does open source make my documents public?',
    a: (
      <>
        No. Our code is public. Your docs aren’t. See the{' '}
        <a href="/privacy">Privacy Policy</a>.
      </>
    ),
  },
];

export function RouteDocuments() {
  setPageSeo({
    title: 'Macro Docs — Markdown Documents, Wired Into Everything',
    description:
      'Markdown docs with live agent edits, offline editing that merges cleanly, and @mentions that link to everything in your company.',
    path: '/documents',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Docs"
        title={['Docs your agents', 'can actually edit.']}
        description={[
          'Agents type into the live doc with you, cursor and all.',
          'It’s fast, works offline, and @mentions reach everything in your company.',
        ]}
        cta="documents_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="documents"
        initialDocument="plan"
        label="Explore Macro Docs"
        caption="A sample workspace. Edit the launch plan, leave a comment, or share it."
      />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#document-agents">
          <EditingGraphic />
          <span>Live agent edits</span>
        </a>
        <a href="#document-offline">
          <ContextGraphic />
          <span>Offline editing</span>
        </a>
        <a href="#document-links">
          <LinkedWorkGraphic />
          <span>@mention anything</span>
        </a>
        <a href="#document-sharing">
          <ThreadGraphic />
          <span>Share by mention</span>
        </a>
      </nav>
      <FeaturePageSection
        id="document-agents"
        title="Agents with a live cursor."
        description={
          'Ask for a rewrite and watch Claude make it, right in the doc you have open.\nKeep typing. Your edits and the agent’s merge as you go.'
        }
      >
        <div class="feature-page-visual">
          <DocumentAgentDemo />
        </div>
        <ProductProse>
          <p>
            Most AI editors hand you a diff or a new version of the file. That’s
            fine for code and annoying for a doc three people are working in. In
            Macro, agents join the document like a teammate, with their own
            cursor. You can watch the edit happen, keep writing somewhere else
            in the doc, and change anything you don’t like. It works when the
            doc is closed, too: ask from a channel, and the edit is there when
            you open it.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="document-offline"
        title="Offline? Keep writing."
        description={
          'Every doc is one CRDT, so edits from different people merge instead of overwriting.\nLose your connection and keep typing. It syncs when you’re back.'
        }
      >
        <div class="feature-page-visual">
          <DocumentOfflineDemo />
        </div>
        <ProductProse>
          <p>
            Notion syncs block by block, so when two people edit the same
            paragraph, the last save wins. Macro stores the whole document as a
            CRDT, a data structure built for merging edits from many people at
            once. Changes save on your device first, then sync to your team.
            Write the whole draft on a plane and it merges cleanly when you
            land.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="document-links"
        title="@mention anything in your company."
        description={
          'People, docs, tasks, channels, emails, and customers.\nMentions link both ways, so the doc knows where it’s referenced too.'
        }
      >
        <div class="feature-page-visual">
          <DocumentMentionsDemo />
        </div>
        <ProductProse>
          <p>
            Notion lets you mention other Notion pages. Macro lets you mention
            the stuff your company actually runs on: the customer email, the
            task, the #support thread, the customer record. Mentions of docs,
            tasks, and emails show up in their References, so from a task you
            can see every doc that cites it. Agents follow the same links, which
            is a big part of why they know what you’re talking about.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="document-sharing"
        title="Share it by mentioning it."
        description={
          '@mention a doc in a channel and everyone in the channel can open it.\nNo access requests, no link settings to get wrong.'
        }
      >
        <div class="feature-page-visual">
          <DocumentSharingDemo />
        </div>
        <ProductProse>
          <p>
            When you mention a doc in a channel, the channel gets access,
            including people who join later. You can still share with
            individuals and pick edit, comment, or view access. Most of the time
            you won’t need to.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="documents-faq-title"
        title="Questions about Macro Docs"
        introduction={
          <p>
            If you’re coming from Notion or Google Docs, the editor will feel
            familiar. Here’s what’s different.
          </p>
        }
        items={documentsFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
