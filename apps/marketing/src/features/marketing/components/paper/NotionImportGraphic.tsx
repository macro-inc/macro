import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import Check from '@icon/system/regular/check.svg';
import Lock from '@icon/system/regular/lock-key.svg';
import { For } from 'solid-js';
import './notion-import-graphic.css';

/** Static preview of connector-import's NativeImportPane, with local fixtures. */
export function NotionImportGraphic() {
  return (
    <div
      class="notion-import-graphic"
      role="img"
      aria-label="Notion importer: select Product roadmap, Customer accounts, and Team wiki, then choose Import 3. Copies do not sync back to Notion."
    >
      <div class="notion-import-panel" aria-hidden="true">
        <div class="notion-import-title">
          <ArrowLeft />
          <span>Import from Notion</span>
        </div>
        <p class="notion-import-description">
          Pick what to copy into Macro. Copies don't sync back to Notion.
        </p>
        <div class="notion-import-selection">Clear selection</div>
        <div class="notion-import-items">
          <For each={['Product roadmap', 'Customer accounts', 'Team wiki']}>
            {(title) => (
              <div class="notion-import-item">
                <span class="notion-import-checkbox">
                  <Check />
                </span>
                <span>{title}</span>
              </div>
            )}
          </For>
        </div>
        <p class="notion-import-security">
          <Lock />
          Encrypted in transit and at rest.
        </p>
        <div class="notion-import-footer">
          <span class="notion-import-search">Search again</span>
          <span class="notion-import-submit">Import 3</span>
        </div>
      </div>
    </div>
  );
}
