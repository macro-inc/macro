import { DocsMarkdownGraphic } from '../../../app/components/featureGraphics/DocsMarkdownScene';
import { HomepageVersionHistory } from './HomepageVersionHistory';
import './homepage-collaborative-doc.css';

/** The documents-page document: it types itself, and @ resolves into the workspace. */
export default function HomepageCollaborativeDoc() {
  return (
    <div class="homepage-collaborative-doc">
      <DocsMarkdownGraphic />
      <div class="homepage-doc-timeline">
        <HomepageVersionHistory />
      </div>
    </div>
  );
}
