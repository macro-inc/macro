import ArrowRight from '@icon/system/regular/arrow-right.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import { useLocation } from '@solidjs/router';
import {
  createEffect,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { ctaHref, handleCtaClick } from '../../../app/utils/utilCta';
import palette from '../../../styles/dark-theme.css?inline';
import uiStyles from '../../../styles/site-ui.css?inline';
import './workspace-story.css';
import './feature-page.css';
import './product-feature-section.css';
import './product-page-preview.css';
import './demo-glass.css';
import { PageOutline } from '../../documentation/components/PageOutline';
import { BENEFIT_PAGES } from '../core/benefit-pages';
import type { TutorialVideoId } from '../core/tutorial-videos';
import { FeatureDemoArt, type FeatureDemoComposition } from './FeatureDemoArt';
import { ProductCopy } from './ProductMention';
import { isEmbeddedProductPage } from './productPagePreview';
import { wallpapers } from './TutorialWallpaper';
import './page-aura.css';

// The frozen UI utilities and palette apply only inside this page. Legacy
// public routes retain their own CSS; no authenticated app styles are loaded.
const uiProperties =
  uiStyles.match(/@property[^{}]*\{[^}]*\}/g)?.join('\n') ?? '';
const scopedUi = uiStyles
  .replace(/@(font-face|property)[^{]*\{[^}]*\}/g, '')
  .replaceAll(':root', ':scope');

export function FeatureUiStyles(
  props: { scope?: '.feature-page' | '.macro-homepage' } = {}
) {
  return (
    <>
      <style>{uiProperties}</style>
      <style>{`@scope (${props.scope ?? '.feature-page'}) { ${scopedUi} ${palette.replaceAll(':root', ':scope')} }`}</style>
    </>
  );
}

export function FeaturePage(props: {
  children: JSX.Element;
  productSpacing?: boolean;
  auraAccent?: string;
}) {
  const embedded = isEmbeddedProductPage();
  const location = useLocation();
  const aura = () => {
    const slug = location.pathname.split('/').filter(Boolean)[0] ?? 'home';
    const aliases: Record<string, TutorialVideoId> = {
      email: 'mail',
      channels: 'chat',
      documents: 'docs',
      'booking-links': 'scheduling',
      snippets: 'macrod',
    };
    const benefit = BENEFIT_PAGES[location.pathname.replace(/^\/docs\//, '')];
    const id = benefit?.tutorial ?? aliases[slug] ?? slug;
    const theme =
      Object.entries(wallpapers).find(([key]) => key === id)?.[1] ??
      wallpapers.home;
    return {
      '--page-aura-primary': props.auraAccent ?? theme.colors[1],
      '--page-aura-secondary': theme.colors[2],
      '--page-aura-deep': theme.colors[3],
    };
  };
  return (
    <main
      class="feature-page"
      style={aura()}
      data-product-preview={embedded ? 'true' : undefined}
      data-product-spacing={props.productSpacing ? 'true' : undefined}
    >
      <FeatureUiStyles />
      {embedded ? props.children : <PageOutline>{props.children}</PageOutline>}
    </main>
  );
}

export function FeaturePageCta(props: { name: string; label?: string }) {
  return (
    <a
      class="site-nav-start feature-page-cta"
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
  title: string | readonly string[];
  description: string;
  demo?: FeatureDemoComposition;
  children?: JSX.Element;
}) {
  let heading: HTMLHeadingElement | undefined;
  let headingText: HTMLSpanElement | undefined;
  const title = () =>
    typeof props.title === 'string' ? props.title : props.title.join(' ');
  const fitHeading = () => {
    if (!heading || !headingText || !heading.clientWidth) return;
    heading.style.removeProperty('font-size');
    if (getComputedStyle(heading).whiteSpace !== 'nowrap') return;
    const size = Number.parseFloat(getComputedStyle(heading).fontSize);
    if (headingText.offsetWidth > heading.clientWidth) {
      heading.style.fontSize = `${Math.floor((size * heading.clientWidth * 10) / headingText.offsetWidth) / 10}px`;
    }
  };
  createEffect(on(title, fitHeading));
  onMount(() => {
    const resize = new ResizeObserver(fitHeading);
    if (heading) resize.observe(heading);
    if (headingText) resize.observe(headingText);
    document.fonts.addEventListener('loadingdone', fitHeading);
    onCleanup(() => {
      resize.disconnect();
      document.fonts.removeEventListener('loadingdone', fitHeading);
    });
  });
  return (
    <section
      class="feature-page-section"
      id={props.id}
      aria-labelledby={`${props.id}-title`}
    >
      <header class="product-feature-intro">
        <h2 ref={heading} id={`${props.id}-title`}>
          <span ref={headingText}>
            <ProductCopy text={title()} />
          </span>
        </h2>
        <p>
          <ProductCopy text={props.description} />
        </p>
      </header>
      <Show when={props.demo} fallback={props.children}>
        {(composition) => (
          <FeatureDemoArt composition={composition()}>
            {props.children}
          </FeatureDemoArt>
        )}
      </Show>
    </section>
  );
}

/** Same reading measure, quiet rules, and disclosures as onboarding security. */
export function FeaturePageFaq(props: {
  id: string;
  eyebrow?: string;
  title: string;
  items: readonly { q: string; a: JSX.Element }[];
  guide?: { href: string; label: string };
  children?: JSX.Element;
}) {
  return (
    <section class="feature-page-reading" aria-labelledby={props.id}>
      <div class="feature-page-reading-rule" aria-hidden="true" />
      <Show when={props.eyebrow}>
        <p class="feature-page-eyebrow">{props.eyebrow}</p>
      </Show>
      <h2 id={props.id}>{props.title}</h2>
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
      <Show when={props.guide}>
        {(guide) => (
          <p class="feature-page-reading-links">
            <a href="#guide">Read the {guide().label} guide ↗</a>
          </p>
        )}
      </Show>
      {props.children}
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
