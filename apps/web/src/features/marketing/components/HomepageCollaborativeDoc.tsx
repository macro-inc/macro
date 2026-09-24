import { DocsMarkdownGraphic } from '../../../../marketing/src/app/components/featureGraphics/DocsMarkdownScene';
import './homepage-collaborative-doc.css';

/** The documents-page document: it types itself, and @ resolves into the workspace. */
export default function HomepageCollaborativeDoc() {
  return (
    <div class="homepage-collaborative-doc">
      <DocsMarkdownGraphic />
    </div>
  );
}
