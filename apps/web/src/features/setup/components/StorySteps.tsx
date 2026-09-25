import '@fontsource-variable/inter';
import { onMount, Show } from 'solid-js';
import {
  ensureGithubStars,
  formatStarCount,
  githubStars,
} from '../../../../marketing/src/app/utils/utilGithubStars';
import IconCasa from '../../../../marketing/src/assets/designs/design-casa.svg';
import IconIso from '../../../../marketing/src/assets/designs/design-iso.svg';
import IconSoc2 from '../../../../marketing/src/assets/designs/design-soc2.svg';
import IconGithub from '../../../../marketing/src/assets/icons/icon-github.svg';
import LogoA16z from '../../../../marketing/src/assets/logos/a16z.svg';
import { ContinueButton } from '../flow/shared';
import { FeatureOverview } from './FeatureOverview';

export function VisionStep(props: {
  onContinue: (features: string[]) => void;
}) {
  return <FeatureOverview onContinue={props.onContinue} />;
}

export function SecurityStep(props: { onContinue: () => void }) {
  onMount(ensureGithubStars);
  return (
    <div class="mx-auto flex w-full max-w-lg flex-col items-center py-2 text-center sm:py-4">
      <section
        data-security-scene
        data-security-proof
        aria-label="Built on trust"
        class="grid w-full grid-cols-1 gap-6 border-b border-edge-muted pb-8 min-[360px]:grid-cols-3 min-[360px]:gap-3 sm:gap-6"
      >
        <a
          data-security-item
          href="https://github.com/macro-inc/macro"
          target="_blank"
          rel="noreferrer"
          class="group flex min-w-0 flex-col items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <span class="flex h-10 items-center justify-center gap-2 whitespace-nowrap text-ink-muted transition-colors group-hover:text-ink">
            <IconGithub class="size-6 shrink-0" aria-hidden="true" />
            <Show when={githubStars() !== null}>
              <svg
                viewBox="0 0 256 256"
                fill="currentColor"
                aria-hidden="true"
                class="size-4 shrink-0 text-orange"
              >
                <path d="M239.2,97.29a16,16,0,0,0-13.81-11L166,81.17,142.72,25.81h0a15.95,15.95,0,0,0-29.44,0L90.07,81.17,30.61,86.32a16,16,0,0,0-9.11,28.06L66.61,153.8,53.09,212.34a16,16,0,0,0,23.84,17.34l51-31,51.11,31a16,16,0,0,0,23.84-17.34l-13.51-58.6,45.1-39.36A16,16,0,0,0,239.2,97.29Z" />
              </svg>
              <span class="text-lg font-semibold leading-none tabular-nums">
                {formatStarCount(githubStars() ?? 0)}
                <span class="sr-only"> GitHub stars</span>
              </span>
            </Show>
          </span>
          <span class="mt-3 text-sm font-normal leading-6 text-ink-extra-muted">
            Open source
          </span>
        </a>
        <div data-security-item class="flex min-w-0 flex-col items-center">
          <span class="flex h-10 w-full items-center justify-center text-ink-muted">
            <LogoA16z
              class="h-auto w-24 max-w-full sm:w-28"
              aria-label="Andreessen Horowitz"
            />
          </span>
          <span class="mt-3 text-sm font-normal leading-6 text-ink-extra-muted">
            $30M+ raised
          </span>
        </div>
        <div data-security-item class="flex min-w-0 flex-col items-center">
          <div
            class="flex h-10 items-center justify-center gap-1.5 text-ink-muted"
            aria-label="Security certifications"
          >
            <IconIso class="size-6 sm:size-7" aria-label="ISO 27001" />
            <IconSoc2 class="size-6 sm:size-7" aria-label="SOC 2" />
            <IconCasa class="size-6 sm:size-7" aria-label="CASA Tier 2" />
          </div>
          <span class="mt-3 text-sm font-normal leading-6 text-ink-extra-muted">
            Audited security
          </span>
        </div>
      </section>
      <h1 tabindex="-1" class="sr-only">
        A workspace built to earn your trust.
      </h1>
      <p class="mb-6 mt-9 max-w-[440px] font-[Inter_Variable] text-sm font-normal leading-6 text-ink-muted sm:text-[15px] [text-wrap:balance]">
        We don’t sell your data or train AI on it. Our agreements with OpenAI
        and Anthropic ensure zero data retention. Review permissions and
        disconnect anytime.
      </p>
      <ContinueButton label="Continue" onClick={props.onContinue} />
    </div>
  );
}
