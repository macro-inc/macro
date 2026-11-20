import { createUniqueId } from 'solid-js';
import { WorkspaceTexture } from '../../setup/components/WorkspaceTexture';
import './feature-demo-backdrop.css';

/** One shared accent wash and onboarding texture for homepage and feature demos. */
export function FeatureDemoBackdrop() {
  const textureId = createUniqueId();
  return (
    <div class="feature-demo-backdrop" aria-hidden="true">
      <WorkspaceTexture accent="var(--feature-glow)" filterId={textureId} />
    </div>
  );
}
