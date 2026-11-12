import { TimelineArtworkBand } from '../../../app/routes/RouteDocuments';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeatureComparisons } from '../components/comparisons/FeatureComparisons';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { DocumentProjectDemo } from '../components/documents/DocumentProjectDemo';
import { DocumentReferencesDemo } from '../components/documents/DocumentReferencesDemo';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import HomepageCollaborativeDoc from '../components/HomepageCollaborativeDoc';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
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
        Markdown. See <a href="/docs/switch-to-macro">migration options</a> for
        your current tools.
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
    a: 'Yes. Share by email address, or turn on a public link so anyone with the link can view a preview without an account.',
  },
  {
    q: 'Does mentioning someone notify them?',
    a: 'Mention them in a comment to send a notification. A mention in the document body does not notify them.',
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
        <a href="/pricing">plans and limits</a> for details.
      </>
    ),
  },
];

export function RouteDocuments() {
  setPageSeo({
    title: 'Macro Docs | Write With Your Team and Your Agents',
    description:
      'The local-first simplicity of Markdown, with mentioning and live collaboration with agents. Edit offline and sync your changes when you reconnect.',
    path: '/documents',
  });
  return (
    <ProductPage>
      <div class="docs-page">
        <ProductHero
          product="Docs"
          title="High speed agentic documents."
          description="Version-controlled markdown, @linked to your work. Edit alongside agents with live cursors."
          cta="documents_hero_get_started"
          tutorial="docs"
        />
        <FeaturePageSection
          id="document-agents"
          demo={{ tone: 'documents', glassFrame: false }}
          title="Agents get a live cursor in the document."
          description="Agents edit the document live, at the same time as you and your team, as opposed to editing the markdown file and giving you a diff. If you go offline and come back on, your changes sync to your peers and conflict resolution happens automatically."
        >
          <DemoInteractionBoundary
            class="feature-page-visual doc-story-page-fade"
            label="Live document collaboration"
            render={() => <DocumentProjectDemo teamEditing />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="document-links"
          demo={{ tone: 'documents', glassFrame: false }}
          title="@mention anything in your workspace."
          description="@mention a customer email from Macro Mail, a task from Macro Tasks, a call, or another doc. Click any of them and it opens right next to the doc, in a split screen."
        >
          <HomepageCollaborativeDoc showHistory={false} />
        </FeaturePageSection>
        <FeaturePageSection
          id="document-organization"
          demo={{ tone: 'documents', glassFrame: false }}
          title="Linked both ways."
          description="@mention a doc in a message and both know about each other. The email, the tasks, and the call you mentioned all know about this doc too, so your workspace becomes a web of context you can navigate in either direction."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            label="Document references"
            render={() => <DocumentReferencesDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="document-version-control"
          title="Version control for every edit."
          description="Track changes by people and agents over time, and scrub back through earlier versions. Docs are just plain markdown, so you can export to a markdown file and import one just as easily."
        >
          <TimelineArtworkBand topGap="40px" />
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
            guide={{ href: '/documents#guide', label: 'documents' }}
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
