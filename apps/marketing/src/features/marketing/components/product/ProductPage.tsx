import GitHubIcon from '@icon/mcp-github.svg';
import MentionIcon from '@icon/system/regular/at.svg';
import CrmIcon from '@icon/system/regular/building-office.svg';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import EmailIcon from '@icon/system/regular/envelope.svg';
import DocsIcon from '@icon/system/regular/file.svg';
import DriveIcon from '@icon/system/regular/folder-simple.svg';
import EventIcon from '@icon/system/regular/lightning.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import TasksIcon from '@icon/system/regular/list-checks.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import CallsIcon from '@icon/system/regular/phone-call.svg';
import CanvasIcon from '@icon/system/regular/shapes.svg';
import AgentsIcon from '@icon/system/regular/sparkle.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import SpreadsheetIcon from '@icon/wide-spreadsheet.svg';
import SkillIcon from '@phosphor/blueprint.svg';
import SnippetIcon from '@phosphor/brackets-curly.svg';
import ChatIcon from '@phosphor/chats-circle.svg';
import FormIcon from '@phosphor/clipboard-text.svg';
import GraphIcon from '@phosphor/graph.svg';
import StackIcon from '@phosphor/stack.svg';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { TutorialVideoId } from '../../core/tutorial-videos';
import { DemoInteractionBoundary } from '../DemoInteractionBoundary';
import { FeaturePage, FeaturePageCta } from '../FeaturePage';
import { TutorialVideoEmbed } from '../TutorialVideoEmbed';
import { ProductIntroduction } from './ProductIntroduction';
import '../email/email-hero.css';
import './product-page.css';
import './product-demo-stage.css';

/** Email's approved geometry, scoped to the product-page rollout. */
export function ProductPage(props: ParentProps<{ auraAccent?: string }>) {
  return (
    <FeaturePage productSpacing auraAccent={props.auraAccent}>
      <div class="product-page">{props.children}</div>
    </FeaturePage>
  );
}

const productIcons = {
  Workspace: StackIcon,
  Pricing: StackIcon,
  Email: EmailIcon,
  Tasks: TasksIcon,
  Chat: ChatIcon,
  Docs: DocsIcon,
  Calls: CallsIcon,
  CRM: CrmIcon,
  Agents: AgentsIcon,
  GitHub: GitHubIcon,
  Spreadsheets: SpreadsheetIcon,
  Databases: DatabaseIcon,
  Forms: FormIcon,
  Canvas: CanvasIcon,
  Snippets: SnippetIcon,
  Calendar: CalendarIcon,
  'Booking links': LinkIcon,
  Drive: DriveIcon,
  Routines: RoutineIcon,
  Skills: SkillIcon,
  'Company graph': MentionIcon,
  'AI tagging': TagIcon,
  'Automatic permissions': GraphIcon,
  'Workspace events': EventIcon,
  'Unified search': SearchIcon,
};

type ProductName = keyof typeof productIcons;

/** The product label links back to the main website. */
export function ProductBrand(props: { product: ProductName }) {
  return (
    <p class="email-page-hero-label">
      <a href="/" target="_self" class="product-home-link">
        <Dynamic component={productIcons[props.product]} aria-hidden="true" />
        <span>Macro {props.product}</span>
      </a>
    </p>
  );
}

export function ProductHero(props: {
  product: ProductName;
  title: string;
  description: string | readonly [string, string];
  cta?: string;
  tutorial?: TutorialVideoId;
  tutorialBackdrop?: boolean;
}) {
  return (
    <>
      <header
        class="feature-page-hero email-page-hero"
        data-product={props.product}
      >
        <ProductBrand product={props.product} />
        <h1>{props.title}</h1>
        <p class="email-page-hero-description">
          {typeof props.description === 'string'
            ? props.description
            : props.description.join(' ')}
        </p>
        <div class="feature-page-hero-actions">
          <Show when={props.cta}>
            {(cta) => <FeaturePageCta name={cta()} />}
          </Show>
        </div>
      </header>
      <Show when={props.tutorial} keyed>
        {(tutorial) => (
          <TutorialVideoEmbed
            tutorial={tutorial}
            backdrop={props.tutorialBackdrop}
          />
        )}
      </Show>
      <ProductIntroduction product={props.product} />
    </>
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
