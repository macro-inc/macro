import type { BrainScope } from './brain-model';

export function AccessPanel(_props: { scope: BrainScope }) {
  return (
    <section class="panel brain-section">
      <h2>Access</h2>
      <p class="brain-empty">Access is unavailable.</p>
    </section>
  );
}
