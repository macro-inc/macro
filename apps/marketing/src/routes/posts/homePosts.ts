import type { PostMeta } from './registry';

// Import only card metadata so the homepage does not load every article body.
const metadata = import.meta.glob<PostMeta>('./entries/*/index.tsx', {
  eager: true,
  import: 'postMeta',
});

export const homePosts = Object.values(metadata)
  .filter((post) => !post.hideFromHome)
  .sort((a, b) => {
    const dateOrder = (b.date ?? '').localeCompare(a.date ?? '');
    return dateOrder || a.title.localeCompare(b.title);
  });
