import MacroLogo from '@icon/macro-logo.svg';
import type { JSX, ParentProps } from 'solid-js';
import { FeaturePage, FeaturePageCta } from '../FeaturePage';
import '../email/email-hero.css';
import './product-page.css';
import './product-demo-stage.css';

/** Email's approved geometry, scoped to the product-page rollout. */
export function ProductPage(props: ParentProps) {
  return (
    <FeaturePage>
      <div class="product-page">{props.children}</div>
    </FeaturePage>
  );
}

export function ProductHero(props: {
  product: string;
  title: readonly [string, string];
  description: readonly [string, string];
  cta: string;
}) {
  return (
    <header class="feature-page-hero email-page-hero">
      <p class="email-page-hero-label">
        <MacroLogo aria-hidden="true" />
        <span>Macro {props.product}</span>
      </p>
      <h1>
        <span>{props.title[0]}</span>
        <span>{props.title[1]}</span>
      </h1>
      <p class="email-page-hero-description">
        {props.description[0]}
        <br class="email-page-hero-break" /> {props.description[1]}
      </p>
      <FeaturePageCta name={props.cta} />
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
}) {
  return (
    <div
      ref={props.ref}
      class="product-demo-stage"
      role="group"
      aria-label={props.label}
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
    </div>
  );
}
