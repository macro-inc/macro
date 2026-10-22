import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeatureComparisons } from '../components/comparisons/FeatureComparisons';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
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
    q: 'What can I write in Macro?',
    a: 'Create notes, briefs, proposals, and handbooks with headings, checklists, tables, images, and code. Link relevant emails, tasks, and files directly in your document.',
  },
  {
    q: 'Can I import and export my documents?',
    a: (
      <>
        Import Notion pages or upload files. Export native Macro documents as
        Markdown. See <a href="/migrate">migration options</a> for your current
        tools.
      </>
    ),
  },
  {
    q: 'Can my team and agents edit together?',
    a: (
      <>
        Yes. People and agents can edit the same document in real time, and
        teammates can comment on specific text. Ask an agent to update the
        document while you keep writing. See <a href="/agents">Macro Agents</a>.
      </>
    ),
  },
  {
    q: 'Who can access a document I share?',
    a: 'Choose view, comment, or edit access when sharing. Mentioning a document in a channel gives its members access. Sources linked inside it keep their own permissions.',
  },
  {
    q: 'Can I share a document outside my team?',
    a: 'Yes. Share by email address, or enable a public link for a document preview people can view without an account. Check the sharing settings before making private work public.',
  },
  {
    q: 'Can I keep writing offline?',
    a: 'You can keep editing an open document if your connection drops. Changes save on your device and sync when you reconnect.',
  },
  {
    q: 'Can I try Macro for free?',
    a: (
      <>
        Yes. Macro has a free plan with usage limits. See{' '}
        <a href="/pricing">plans and limits</a> before choosing a plan for your
        team.
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
          title={['Fast collaborative docs', 'for your team and agents.']}
          description="The simplicity of Markdown, with live collaboration for people and agents. We didn’t want to choose between a plain text editor and a shared document."
          cta="documents_hero_get_started"
        />
        <WorkspaceDesktopDemo
          heroFrame
          view="documents"
          label="Explore Macro Docs"
          render={() => <DocumentProjectDemo teamEditing />}
        />
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
          title={['Your agent has a cursor,', 'just like you.']}
          description="Ask an agent to update a section while you keep writing. You can see its cursor and changes in the same document as your teammates. If your connection drops, keep editing; Macro merges your changes when you reconnect."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <DocumentAgentDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="document-links"
          title={['Mention the work', 'you’re writing about.']}
          description="A document rarely tells the whole story. Mention the customer email, task, call, or conversation behind it. Each source links back to the doc, and you can open it alongside what you’re writing. Share the doc in a channel to give the channel access."
        >
          <DemoInteractionBoundary
            class="feature-page-visual docs-wide-demo"
            render={() => <DocumentMentionsDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="document-organization"
          title={['Organize docs', 'with folders and tags.']}
          description="Keep the files where you expect them. Use folders for structure and tags when a document belongs to several projects. Write in Markdown and export it as Markdown; the document is still yours."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <DocumentOrganizationDemo />}
          />
        </FeaturePageSection>
        <section
          id="documents-comparison"
          aria-label="Compare Macro and Notion"
        >
          <FeatureComparisons
            title="Compare Workspaces"
            comparisons={documentComparisons}
          />
        </section>
        <div>
          <FeaturePageFaq
            id="documents-faq-title"
            title="Questions about Macro Docs"
            items={documentsFaq}
          />
        </div>
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}
