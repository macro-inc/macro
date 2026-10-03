import ArrowRight from '@phosphor/arrow-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import { For, type JSX, Show } from 'solid-js';
import { ctaHref, handleCtaClick } from '../../../app/utils/utilCta';
import palette from '../../../styles/dark-theme.css?inline';
import uiStyles from '../../../styles/site-ui.css?inline';
import { HomepageFeatureHeading } from './HomepageFeatureHeading';
import './workspace-story.css';
import './feature-page.css';

// The frozen UI utilities and palette apply only inside this page. Legacy
// public routes retain their own CSS; no authenticated app styles are loaded.
const uiProperties =
  uiStyles.match(/@property[^{}]*\{[^}]*\}/g)?.join('\n') ?? '';
const scopedUi = uiStyles
  .replace(/@(font-face|property)[^{]*\{[^}]*\}/g, '')
  .replaceAll(':root', ':scope');

export function FeaturePage(props: { children: JSX.Element }) {
  return (
    <main class="feature-page" data-theme-light="false">
      <style>{uiProperties}</style>
      <style>{`@scope (.feature-page) { ${scopedUi} ${palette.replaceAll(':root', ':scope')} }`}</style>
      {props.children}
    </main>
  );
}

export function FeaturePageCta(props: { name: string; label?: string }) {
  return (
    <a
      class="feature-page-cta"
      href={ctaHref()}
      onClick={(event) => handleCtaClick(event, props.name)}
    >
      {props.label ?? 'Get started'}
      <ArrowRight aria-hidden="true" />
    </a>
  );
}

export function FeaturePageSection(props: {
  id: string;
  title: string;
  description: string;
  children: JSX.Element;
}) {
  return (
    <section
      class="feature-page-section"
      id={props.id}
      aria-labelledby={`${props.id}-title`}
    >
      <HomepageFeatureHeading
        id={`${props.id}-title`}
        title={props.title}
        description={props.description}
      />
      {props.children}
    </section>
  );
}

/** Same reading measure, quiet rules, and disclosures as onboarding security. */
export function FeaturePageFaq(props: {
  id: string;
  eyebrow?: string;
  title: string;
  introduction: JSX.Element;
  items: readonly { q: string; a: JSX.Element }[];
}) {
  return (
    <section class="feature-page-reading" aria-labelledby={props.id}>
      <div class="feature-page-reading-rule" aria-hidden="true" />
      <Show when={props.eyebrow}>
        <p class="feature-page-eyebrow">{props.eyebrow}</p>
      </Show>
      <h2 id={props.id}>{props.title}</h2>
      <div class="feature-page-prose">{props.introduction}</div>
      <h3>Frequently asked questions</h3>
      <div class="feature-page-faq">
        <For each={props.items}>
          {(item) => (
            <details class="feature-page-faq__item">
              <summary>
                <span>{item.q}</span>
                <CaretDown aria-hidden="true" />
              </summary>
              <p class="feature-page-faq__answer">{item.a}</p>
            </details>
          )}
        </For>
      </div>
      <p class="feature-page-reading-links">
        Read our <a href="/privacy">Privacy Policy</a> or visit the{' '}
        <a href="https://security.macro.com" target="_blank" rel="noreferrer">
          Trust Center
        </a>
        .
      </p>
    </section>
  );
}
