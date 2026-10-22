import MacroLogo from '@icon/macro-logo.svg';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { DemoInteractionBoundary } from '../DemoInteractionBoundary';
import { FeaturePage, FeaturePageCta } from '../FeaturePage';
import '../email/email-hero.css';
import './product-page.css';
import './product-demo-stage.css';

/** Email's approved geometry, scoped to the product-page rollout. */
export function ProductPage(props: ParentProps) {
  return (
    <FeaturePage productSpacing>
      <div class="product-page">{props.children}</div>
    </FeaturePage>
  );
}

/** A home link distinct from the current product name. */
export function ProductBrand(props: { product: string }) {
  return (
    <p class="email-page-hero-label">
      <a
        href="/"
        target="_self"
        class="product-home-link"
        aria-label="Macro home"
      >
        <MacroLogo width="20" height="20" aria-hidden="true" />
        <span>Macro</span>
      </a>
      <span aria-hidden="true">/</span>
      <span>{props.product}</span>
    </p>
  );
}

export function ProductHero(props: {
  product: string;
  title: readonly [string, string];
  description: string | readonly [string, string];
  cta?: string;
}) {
  return (
    <header class="feature-page-hero email-page-hero">
      <ProductBrand product={props.product} />
      <h1>
        <span>{props.title[0]}</span>
        <span>{props.title[1]}</span>
      </h1>
      <p class="email-page-hero-description">
        {typeof props.description === 'string' ? (
          props.description
        ) : (
          <>
            {props.description[0]}
            <br class="email-page-hero-break" /> {props.description[1]}
          </>
        )}
      </p>
      <Show when={props.cta}>{(cta) => <FeaturePageCta name={cta()} />}</Show>
    </header>
  );
}

export function ProductProse(props: ParentProps) {
  return <div class="product-prose">{props.children}</div>;
}

/** The same glass utility used by email and the homepage composer. */
export function ProductDemo(props: {
  label: string;
  children: JSX.Element;
  ref?: (element: HTMLDivElement) => void;
  onInteract?: () => void;
  action?: string;
  /** Window height in px, so short scenes don't leave an empty frame. */
  height?: number;
  mobileHeight?: number;
}) {
  return (
    <DemoInteractionBoundary
      label={props.label}
      ref={props.ref}
      class="product-demo-stage"
      role="group"
      aria-label={props.label}
      style={{
        '--demo-h': props.height ? `${props.height}px` : undefined,
        '--demo-h-mobile': props.mobileHeight
          ? `${props.mobileHeight}px`
          : undefined,
      }}
      onPointerDown={() => props.onInteract?.()}
      onKeyDown={() => props.onInteract?.()}
    >
      <div
        class="product-demo glass workspace-demo portal-scope dummy-workspace"
        data-theme="dark"
        data-action={props.action}
      >
        <div class="dummy-main">{props.children}</div>
      </div>
    </DemoInteractionBoundary>
  );
}
