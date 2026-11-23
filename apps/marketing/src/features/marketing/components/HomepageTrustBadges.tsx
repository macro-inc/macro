import { onMount, Show } from 'solid-js';
import {
  ensureGithubStars,
  formatStarCount,
  githubStars,
} from '../../../app/utils/utilGithubStars';
import IconCasa from '../../../assets/designs/design-casa.svg';
import IconSoc2 from '../../../assets/designs/design-soc2.svg';
import IconGithub from '../../../assets/icons/icon-github.svg';
import LogoA16z from '../../../assets/logos/a16z.svg';
import './homepage-trust-badges.css';

function GithubBadge() {
  onMount(ensureGithubStars);
  // Use the last verified count for first paint and when GitHub is unavailable.
  const stars = () => formatStarCount(githubStars() ?? 6447);
  return (
    <a
      class="homepage-github-badge"
      href="https://github.com/macro-inc/macro"
      target="_blank"
      rel="noreferrer"
      aria-label={`Macro on GitHub, ${stars()} stars, #1 trending in August`}
    >
      <strong>
        <IconGithub aria-hidden="true" />
        <span aria-hidden="true">★</span> {stars()}
      </strong>
      <span>#1 trending in August</span>
    </a>
  );
}

export function HomepageTrustBadges(props: { showGithub?: boolean }) {
  return (
    <div class="homepage-open-source-badges">
      <div class="homepage-open-source-backing">
        <LogoA16z aria-label="Andreessen Horowitz" viewBox="0 0 169 40" />
        <span>$30M raised</span>
      </div>
      <div class="homepage-open-source-security">
        <div aria-label="Security certifications">
          <IconSoc2 aria-label="AICPA SOC 2" />
          <IconCasa aria-label="CASA Tier 2" />
        </div>
        <span>SOC 2 · CASA Tier 2</span>
      </div>
      <Show when={props.showGithub}>
        <GithubBadge />
      </Show>
    </div>
  );
}
