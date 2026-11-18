import { createUniqueId } from 'solid-js';
import { ContextScene } from '../../setup/components/WelcomeSteps';
import { WorkspaceTexture } from '../../setup/components/WorkspaceTexture';
import './homepage-feature-links.css';

/** The production welcome constellation shared by desktop and mobile. */
export function HomepageFeatureLinks() {
  const textureId = createUniqueId();
  return (
    <div class="homepage-feature-links">
      <div class="homepage-constellation-wash" aria-hidden="true">
        <WorkspaceTexture accent="#c3aaa1" filterId={textureId} />
      </div>
      <ContextScene />
    </div>
  );
}
