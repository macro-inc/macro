import { createSignal } from 'solid-js';
import { isServer } from 'solid-js/web';

const REPO = 'macro-inc/macro';

const [githubStars, setGithubStars] = createSignal<number | null>(null);
let started = false;

export function ensureGithubStars() {
  if (started || isServer) return;
  started = true;
  fetch(`https://api.github.com/repos/${REPO}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && typeof data.stargazers_count === 'number') {
        setGithubStars(data.stargazers_count);
      }
    })
    .catch(() => {});
}

export function formatStarCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return count.toLocaleString('en-US');
}

export { githubStars };
