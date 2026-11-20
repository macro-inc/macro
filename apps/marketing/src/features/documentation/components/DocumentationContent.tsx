import { type JSX, type ParentProps, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { TutorialVideoEmbed } from '../../marketing/components/TutorialVideoEmbed';
import { GuideGraphic } from './GuideGraphic';
import { SecurityBadges } from './SecurityBadges';

type BlockProps = ParentProps<{
  title?: string;
  href?: string;
  caption?: string;
  label?: string;
}>;

function Card(props: BlockProps) {
  return (
    <Dynamic
      component={props.href ? 'a' : 'section'}
      href={props.href}
      class="doc-card"
    >
      <strong>
        {props.title}
        <Show when={props.href}>
          <span aria-hidden="true"> ↗</span>
        </Show>
      </strong>
      <div>{props.children}</div>
    </Dynamic>
  );
}
function Accordion(props: BlockProps) {
  return (
    <details class="doc-accordion">
      <summary>{props.title}</summary>
      <div>{props.children}</div>
    </details>
  );
}
function Frame(props: BlockProps) {
  return (
    <figure class="doc-frame">
      {props.children}
      <Show when={props.caption}>
        <figcaption>{props.caption}</figcaption>
      </Show>
    </figure>
  );
}
function Step(props: BlockProps) {
  return (
    <section class="doc-step">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}
function Tab(props: BlockProps) {
  return (
    <details class="doc-platform" open>
      <summary>{props.title}</summary>
      {props.children}
    </details>
  );
}
function Tabs(props: ParentProps) {
  return <div class="doc-platforms">{props.children}</div>;
}
function Callout(props: BlockProps & { kind: string }) {
  return (
    <aside class={`doc-callout doc-callout-${props.kind}`}>
      <strong>{props.title ?? props.kind}</strong>
      {props.children}
    </aside>
  );
}
function Update(props: BlockProps) {
  return (
    <section class="doc-update">
      <h2>{props.label}</h2>
      {props.children}
    </section>
  );
}
function Table(props: ParentProps) {
  return (
    <div class="doc-table-scroll" tabIndex={0} role="region" aria-label="Table">
      <table>{props.children}</table>
    </div>
  );
}
function Image(props: JSX.ImgHTMLAttributes<HTMLImageElement>) {
  return <img {...props} loading="lazy" />;
}
// MDX uses component lookups for markdown tags; Solid needs functions rather
// than the string tag defaults emitted for React's JSX runtime.
const nativeTags = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'del',
  'blockquote',
  'pre',
  'code',
  'hr',
  'br',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'input',
] as const;
export const documentationComponents = {
  ...Object.fromEntries(
    nativeTags.map((tag) => [
      tag,
      (props: ParentProps) => <Dynamic component={tag} {...props} />,
    ])
  ),
  GuideGraphic,
  SecurityBadges,
  TutorialVideoEmbed,
  Card,
  CardGroup: (props: ParentProps) => (
    <div class="doc-cards">{props.children}</div>
  ),
  Accordion,
  AccordionGroup: (props: ParentProps) => <div>{props.children}</div>,
  Frame,
  Step,
  Steps: (props: ParentProps) => <div class="doc-steps">{props.children}</div>,
  Tabs,
  Tab,
  Update,
  Info: (props: BlockProps) => <Callout {...props} kind="Info" />,
  Note: (props: BlockProps) => <Callout {...props} kind="Note" />,
  Tip: (props: BlockProps) => <Callout {...props} kind="Tip" />,
  Warning: (props: BlockProps) => <Callout {...props} kind="Warning" />,
  Icon: (props: {
    icon?: string;
    iconType?: string;
    color?: string;
    size?: number;
  }) => (
    <svg
      width={props.size ?? 12}
      height={props.size ?? 12}
      viewBox="0 0 12 12"
      style={{ color: props.color, 'flex-shrink': 0 }}
      aria-hidden="true"
    >
      <circle
        cx="6"
        cy="6"
        r="4.5"
        fill={props.iconType === 'solid' ? 'currentColor' : 'none'}
        stroke="currentColor"
      />
      <Show when={props.icon === 'circle-dot'}>
        <circle cx="6" cy="6" r="2" fill="currentColor" />
      </Show>
    </svg>
  ),
  table: Table,
  img: Image,
};
