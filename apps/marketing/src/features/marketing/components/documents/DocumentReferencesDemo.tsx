import Hash from '@icon/system/regular/hash.svg';
import { createSignal } from 'solid-js';
import { homepagePeople } from '../../core/homepage-demo-people';
import { ProductDemo } from '../product/ProductPage';
import { PanelSection } from '../workspace/frozen/DetailPanel';
import { DocumentFrame } from './DocumentFrame';
import { DocumentSourceSurface } from './DocumentProjectDemo';
import { PROJECT_INTRO, PROJECT_TAGS, PROJECT_TITLE } from './documentProject';

/** The document's incoming reference opens the conversation that mentioned it. */
export function DocumentReferencesDemo() {
  const [sourceOpen, setSourceOpen] = createSignal(false);
  let reference: HTMLButtonElement | undefined;
  return (
    <div class="doc-story doc-references-demo">
      <ProductDemo label="Document references" height={490} mobileHeight={440}>
        <DocumentSourceSurface
          source={sourceOpen() ? 'channel' : undefined}
          onClose={() => {
            setSourceOpen(false);
            queueMicrotask(() => reference?.focus({ preventScroll: true }));
          }}
        >
          <DocumentFrame
            title={PROJECT_TITLE}
            tags={PROJECT_TAGS}
            panelOpen
            panel={
              <PanelSection title="References (1)" open>
                <button
                  ref={reference}
                  type="button"
                  class="doc-ref-row doc-reference-link"
                  aria-label="Open Jacob's reference in website"
                  onClick={() => setSourceOpen(true)}
                >
                  <span class="doc-ref-head">
                    <img src={homepagePeople.jacob.photo} alt="" />
                    <b>Jacob</b>
                    <span class="doc-ref-in">in</span>
                    <span class="doc-ref-source">
                      <Hash />
                      <span>website</span>
                    </span>
                    <span class="doc-ref-time">9:31 AM</span>
                  </span>
                  <span class="doc-ref-body">
                    put everything in here · Website brief
                  </span>
                </button>
              </PanelSection>
            }
          >
            <h2>What we’re changing</h2>
            <p>
              Make the homepage easier to scan. Show what the product does
              before asking people to sign up.
            </p>
            <h2>Pricing</h2>
            <p>{PROJECT_INTRO}</p>
            <h2>Before we publish</h2>
            <p>
              Teo checks mobile. Julia reviews the copy. Jacob tests signup.
            </p>
          </DocumentFrame>
        </DocumentSourceSurface>
      </ProductDemo>
    </div>
  );
}
