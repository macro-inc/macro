import poster from '../../../../assets/mark-desync-placeholder.jpg';
import type { PostMeta } from '../../registry';

export const postMeta: PostMeta = {
  slug: 'desync-customer-story',
  title: 'Desync switches to Macro',
  description:
    'Mark Evgenev, founder and CEO of Desync, on getting organized with Macro.',
  category: 'Customer stories',
  tags: ['customer stories'],
  showTOC: false,
};

export default function DesyncCustomerStory() {
  return (
    <article>
      <blockquote>
        “Macro did not help us get organized. Macro is why we are organized.”
      </blockquote>
      <p>Mark Evgenev, Founder/CEO, Desync</p>
      <video
        controls
        playsinline
        preload="none"
        poster={poster}
        src="/video/desync.mp4"
        aria-label="Desync customer story"
        style={{ width: '100%', 'border-radius': '24px' }}
      />
      <p>
        Moving your own team? The{' '}
        <a href="/docs/switch-to-macro">switching guide</a> covers Notion,
        Linear, Slack, and other tools.
      </p>
    </article>
  );
}
