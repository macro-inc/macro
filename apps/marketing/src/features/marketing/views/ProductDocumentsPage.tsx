import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeatureComparisons } from '../components/comparisons/FeatureComparisons';
import { DocumentOrganizationDemo } from '../components/documents/DocumentOrganizationDemo';
import { DocumentProjectDemo } from '../components/documents/DocumentProjectDemo';
import {
  DocumentAgentDemo,
  DocumentMentionsDemo,
} from '../components/documents/DocumentStories';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  EditingGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';
import { documentComparisons } from '../core/feature-comparisons';

const documentsFaq = [
  {
    q: 'How is organizing docs different from Notion?',
    a: 'Notion stores uploaded files in pages or database properties. Importing a supported document converts its contents into a Notion page. Macro keeps docs and files as workspace items you can put in folders and tag alongside emails and tasks. Both support Markdown import and export.',
  },
  {
    q: 'What can I write in Macro?',
    a: 'Notes, briefs, proposals, handbooks, and everyday drafts. Use headings, checklists, tables, images, code, and Markdown shortcuts. Write together in real time and leave comments on specific text.',
  },
  {
    q: 'How does live collaboration work?',
    a: 'Macro uses CRDTs to merge edits from people and agents, even within the same paragraph. Everyone sees changes as they happen. You can also browse earlier versions of a doc and make a new copy from one.',
  },
  {
    q: 'Can I keep writing offline?',
    a: 'Yes. Keep editing an open doc when your connection drops. Changes save on your device and merge with your team’s edits when you reconnect.',
  },
  {
    q: 'Who can open a doc I share?',
    a: 'Share with individuals or mention the doc in a channel to give its members access. Choose view, comment, or edit access. Sources linked inside the doc keep their own permissions.',
  },
  {
    q: 'Can I share with someone outside Macro?',
    a: 'Yes. Share by email address or enable a public link. People can view the public document preview without creating an account.',
  },
  {
    q: 'Can I bring my docs in and take them out?',
    a: (
      <>
        Import Notion pages or upload files. Export native Macro docs as
        Markdown. See <a href="/migrate">moving to Macro</a>.
      </>
    ),
  },
];

export function RouteDocuments() {
  setPageSeo({
    title: 'Macro Docs | Write With Your Team and Your Agents',
    description:
      'Write in Markdown and collaborate live with people and agents. Link emails and tasks, open them beside your doc, and organize your work with folders and tags.',
    path: '/documents',
  });
  return (
    <ProductPage>
      <div class="docs-page">
        <ProductHero
          product="Docs"
          title={['Write with your team', 'and your agents.']}
          description={[
            'Write together using your emails, tasks,',
            'and conversations already in Macro.',
          ]}
          cta="documents_hero_get_started"
        />
        <WorkspaceDesktopDemo
          heroFrame
          view="documents"
          label="Explore Macro Docs"
        >
          <DocumentProjectDemo />
        </WorkspaceDesktopDemo>
        <nav
          class="feature-page-jump-links docs-jump-links"
          aria-label="On this page"
        >
          <a href="#document-agents">
            <EditingGraphic />
            <span>Write with agents</span>
          </a>
          <a href="#document-links">
            <LinkedWorkGraphic />
            <span>Link your work</span>
          </a>
          <a href="#document-organization">
            <ThreadGraphic />
            <span>Folders and tags</span>
          </a>
        </nav>
        <FeaturePageSection
          id="document-agents"
          title="Write alongside your agent."
          description="Ask it to use your emails and tasks to update the doc. Both of you can edit the same paragraph, with changes merging as you type."
        >
          <div class="feature-page-visual">
            <DocumentAgentDemo />
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="document-links"
          title="Open emails and tasks beside your doc."
          description="Link to the work you’re writing about. Open the original email, task, or conversation without closing your doc."
        >
          <div class="feature-page-visual docs-wide-demo">
            <DocumentMentionsDemo />
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="document-organization"
          title="Organize docs with folders and tags."
          description="Keep a doc in its folder and find it through any of its tags, alongside related emails and tasks."
        >
          <div class="feature-page-visual">
            <DocumentOrganizationDemo />
          </div>
        </FeaturePageSection>
        <section
          id="documents-comparison"
          aria-label="Compare Macro and Notion"
        >
          <FeatureComparisons comparisons={documentComparisons} />
        </section>
        <div>
          <FeaturePageFaq
            id="documents-faq-title"
            title="Frequently asked questions"
            items={documentsFaq}
          />
        </div>
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}
