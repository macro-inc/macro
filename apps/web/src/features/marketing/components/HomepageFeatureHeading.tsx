import type { JSX } from 'solid-js';

export function HomepageFeatureHeading(props: {
  id: string;
  title: string;
  description: string;
  children?: JSX.Element;
}) {
  return (
    <header class="homepage-feature-heading homepage-enter workspace-demo">
      {props.children}
      <h2 id={props.id}>{props.title}</h2>
      <div class="homepage-section-break">
        <span aria-hidden="true" />
        <p>{props.description}</p>
        <span aria-hidden="true" />
      </div>
    </header>
  );
}
