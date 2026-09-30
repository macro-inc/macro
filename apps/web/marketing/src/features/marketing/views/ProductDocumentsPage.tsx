import { setPageSeo } from '../../../app/utils/utilSeo';
import {
  DocumentAgentDemo,
  DocumentDiscussionDemo,
  DocumentEditingDemo,
  DocumentLinkedTaskDemo,
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

export function RouteDocuments() {
  setPageSeo({
    title: 'Macro Docs — Markdown Documents, Wired Into Everything',
    description:
      'Markdown documents built on CRDTs, with offline editing, automatic sync, live agent edits, and bidirectional links to tasks, email, and chat.',
    path: '/documents',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Docs"
        title={['Markdown docs with', 'live agent edits.']}
        description={[
          'Local-first. Built on CRDTs.',
          'Write offline. Sync when you’re back.',
        ]}
        cta="documents_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="documents"
        initialDocument="plan"
        label="Explore Macro Docs"
        caption="Edit the launch plan, leave a comment, or share it in the sample workspace."
      />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#document-editor">
          <EditingGraphic />
          <span>CRDT editing</span>
        </a>
        <a href="#document-agents">
          <ContextGraphic />
          <span>Ask for an edit</span>
        </a>
        <a href="#document-discussion">
          <ThreadGraphic />
          <span>Comments</span>
        </a>
        <a href="#document-links">
          <LinkedWorkGraphic />
          <span>Bidirectional links</span>
        </a>
      </nav>
      <FeaturePageSection
        id="document-editor"
        title="Built on CRDTs. Ready offline."
        description={
          'Edits apply locally as you type.\nConcurrent changes merge automatically when you reconnect.'
        }
      >
        <div class="feature-page-visual">
          <DocumentEditingDemo />
        </div>
        <ProductProse>
          <p>
            Macro documents use CRDTs: data structures that merge concurrent
            edits. Your changes are saved locally, and the sync service combines
            them with changes from other editors when you reconnect.
          </p>
          <p>
            The editor supports Markdown, headings, lists, and rich @mentions.
            Local snapshots and an edit log let you keep writing through a
            dropped connection.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="document-agents"
        title="Agents edit the live document."
        description={
          'Ask for a rewrite, a checklist, or a structural change.\nWatch the edit appear in the document you’re already writing.'
        }
      >
        <div class="feature-page-visual">
          <DocumentAgentDemo />
        </div>
        <ProductProse>
          <p>
            Agents use the document’s collaboration system to apply edits
            directly. You can write alongside them and continue editing the
            result.
          </p>
          <p>
            Ask Claude to shorten a section, turn meeting notes into a brief, or
            restructure a draft. The agent reads the document and changes its
            text and formatting in place.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="document-discussion"
        title="Comments belong to the document."
        description={
          'Ask a question, mention a teammate, and reply in the document’s discussion.\nThe conversation is available to the next editor and to your agents.'
        }
      >
        <div class="feature-page-visual">
          <DocumentDiscussionDemo />
        </div>
        <ProductProse>
          <p>
            Each document has its own discussion. Teammates can leave feedback,
            reply, and @mention the people responsible for a decision.
          </p>
          <p>
            Agents can read the discussion as well as the draft. Ask for an edit
            based on the feedback your team has already given.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="document-links"
        title="@mentions link in both directions."
        description={
          'Mention a task, email, call, or channel inside a document.\nOpen the reference, or follow its backlink to the document.'
        }
      >
        <div class="feature-page-visual">
          <DocumentLinkedTaskDemo />
        </div>
        <ProductProse>
          <p>
            A Macro @mention is a reference to a real workspace item. It shows
            up in the document and in the referenced item’s backlinks, so you
            can navigate in either direction.
          </p>
          <p>
            Link a task to its specification, a customer to a proposal, or a
            call to its meeting notes. People and agents can follow those
            references to read the source.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="document-sharing"
        title="Share through your channels."
        description={
          'Mention a document in a channel to share it with that team.\nOr choose individual edit, comment, and view access.'
        }
      >
        <div class="feature-page-visual">
          <DocumentSharingDemo />
        </div>
        <ProductProse>
          <p>
            When you have permission to share a document, mentioning it in a
            channel grants access to that channel. Membership determines who can
            open the shared work.
          </p>
          <p>
            Use Share for individual recipients and access levels. The document
            stays live: edits sync to everyone who has access.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="documents-faq-title"
        eyebrow="Under the hood"
        title="Markdown, CRDTs, and agents."
        introduction={
          <p>
            A local-first editor with concurrent editing, rich references, and
            direct agent edits.
          </p>
        }
        items={[
          {
            q: 'What kind of documents can I edit?',
            a: 'Native Macro documents use Markdown and a collaborative editor. They support familiar headings, lists, links, and rich references to workspace items.',
          },
          {
            q: 'Can an agent edit the document directly?',
            a: (
              <>
                Yes. Agents can apply specific edits to native Markdown
                documents. Uploaded files such as PDFs are readable context, but
                are not the same editable document type. See{' '}
                <a href="/agents">agents in Macro</a>.
              </>
            ),
          },
          {
            q: 'Can I link tasks and conversations?',
            a: (
              <>
                Yes. Mention workspace items in a document so people can open
                the related <a href="/tasks">task</a> or{' '}
                <a href="/channels">conversation</a>.
              </>
            ),
          },
          {
            q: 'Can I choose who can edit?',
            a: 'Yes. The Share form lets you choose recipients and access levels. When you have permission to share, a channel @mention can grant access to that channel.',
          },
          {
            q: 'Can I edit offline?',
            a: 'Yes. Native documents save edits locally. CRDT sync merges those edits with concurrent changes from other editors when you reconnect.',
          },
          {
            q: 'Does open source make my documents public?',
            a: (
              <>
                No. The application code is open source; document access follows
                its sharing permissions. See the{' '}
                <a href="/privacy">Privacy Policy</a>.
              </>
            ),
          },
        ]}
      />
      <HomepageClosing />
    </ProductPage>
  );
}
