import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import {
  BuildsThemselvesGraphic,
  CrmAgentPanel,
  DiscussionGraphic,
  HeroCompanyWindow,
} from '../components/featureGraphics/CrmGraphics';
import { CrmFeatureGrid } from '../components/sections/CrmFeatureGrid';
import { CrmUiGrid } from '../components/sections/CrmUiGrid';
import { HeroEyebrow } from '../components/sections/HeroEyebrow';
import {
  HomeAppPreview,
  HomeHeroBackdrop,
} from '../components/sections/HomeAppPreview';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import {
  type LoopsFeatureBlock,
  LoopsFeatureSection,
  loopsFeatureHoverStyles,
} from '../components/sections/LoopsFeatureSection';
import { SectionFaq } from '../components/sections/SectionFaq';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { HeroScaleToFit } from '../components/utils/HeroScaleToFit';
import { viewportWidth } from '../utils/utilBreakpoint';
import { CtaIcon, ctaHref, ctaLabel, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

const mobile = () => viewportWidth() < 700;

// ---------------------------------------------------------------------------
// CTAs
// ---------------------------------------------------------------------------

function ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="crm-cta-button"
      onClick={(event) => handleCtaClick(event, props.buttonName)}
      style={{
        'align-items': 'center',
        'background-color': 'var(--a0)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': mobile() ? '15px' : props.large ? '18px' : '16px',
        'font-weight': '700',
        gap: '8px',
        height: mobile() ? '40px' : props.large ? '46px' : '40px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        overflow: 'hidden',
        padding: mobile() ? '0 20px' : props.large ? '0 28px' : '0 22px',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
        width: mobile() ? '100%' : 'max-content',
      }}
    >
      <CtaIcon size={mobile() ? 16 : 15} />
      {ctaLabel('Connect with Google')}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Spotlight feature blocks
// ---------------------------------------------------------------------------

// Full-bleed spotlight: dimmed HeroCompanyWindow behind + CrmAgentPanel lifted.
function CrmAgentSpotlight() {
  const FADE =
    'linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%)';
  const compact = () => viewportWidth() < 700;
  return (
    <Show
      when={!compact()}
      fallback={
        <div style={{ display: 'grid', gap: '20px', width: '100%' }}>
          <HeroScaleToFit active designWidth={640}>
            <HeroCompanyWindow />
          </HeroScaleToFit>
          <div style={{ position: 'relative' }}>
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(75% 70% at 50% 42%, color-mix(in srgb, var(--ambient-ink) 10%, transparent) 0%, transparent 74%)',
                inset: '-12% -8%',
                'pointer-events': 'none',
                position: 'absolute',
                'z-index': 0,
              }}
            />
            <div
              style={{
                filter: 'drop-shadow(0 24px 48px rgb(0 0 0 / 0.5))',
                position: 'relative',
                'z-index': 1,
              }}
            >
              <CrmAgentPanel />
            </div>
          </div>
        </div>
      }
    >
      <div style={{ position: 'relative', width: '100%' }}>
        {/* Dimmed company record */}
        <div
          aria-hidden="true"
          style={{
            filter: 'saturate(0.9)',
            '-webkit-mask-image': FADE,
            'mask-image': FADE,
            opacity: '0.45',
            'pointer-events': 'none',
          }}
        >
          <HeroCompanyWindow />
        </div>
        {/* Progressive blur layers */}
        <For
          each={[
            { blur: 2, from: 18, to: 58 },
            { blur: 5, from: 44, to: 82 },
            { blur: 11, from: 66, to: 96 },
          ]}
        >
          {(layer) => {
            const mask = `linear-gradient(to right, transparent ${layer.from}%, #000 ${layer.to}%)`;
            return (
              <div
                aria-hidden="true"
                style={{
                  'backdrop-filter': `blur(${layer.blur}px)`,
                  '-webkit-backdrop-filter': `blur(${layer.blur}px)`,
                  inset: '0',
                  '-webkit-mask-image': mask,
                  'mask-image': mask,
                  'pointer-events': 'none',
                  position: 'absolute',
                }}
              />
            );
          }}
        </For>
        {/* Lifted agent panel */}
        <div
          style={{
            'align-items': 'center',
            display: 'grid',
            inset: '0',
            'justify-items': 'end',
            position: 'absolute',
          }}
        >
          <div
            style={{
              'max-width': '432px',
              'padding-right': '3%',
              position: 'relative',
              transform: 'translateY(-20px)',
              width: '100%',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(72% 72% at 50% 50%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)',
                inset: '-16% -12%',
                'pointer-events': 'none',
                position: 'absolute',
                'z-index': 0,
              }}
            />
            <div
              style={{
                filter: 'drop-shadow(0 40px 80px rgb(0 0 0 / 0.55))',
                position: 'relative',
                'z-index': 1,
              }}
            >
              <CrmAgentPanel />
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

// Generic spotlight: a graphic lifted in front of the dimmed company record.
// `lift` varies where the graphic sits so consecutive sections don't repeat
// the same centered composition (the agent section lifts right).
function CrmSpotlight(props: {
  children: JSX.Element;
  liftMaxWidth?: string;
  lift?: 'center' | 'start';
}) {
  const compact = () => mobile();
  const lift = () => props.lift ?? 'center';
  return (
    <Show
      when={!compact()}
      fallback={
        <div
          style={{ display: 'grid', 'justify-items': 'center', width: '100%' }}
        >
          <div
            style={{
              width: '100%',
              'max-width': props.liftMaxWidth ?? '560px',
            }}
          >
            {props.children}
          </div>
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            filter: 'saturate(0.9)',
            '-webkit-mask-image':
              'linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%)',
            'mask-image':
              'linear-gradient(to bottom, #000 0%, #000 72%, transparent 100%)',
            'max-width': '1040px',
            opacity: '0.4',
            'pointer-events': 'none',
            width: '100%',
          }}
        >
          <HeroCompanyWindow />
        </div>
        <div
          style={{
            'align-items': 'center',
            display: 'grid',
            inset: '0',
            'justify-items': lift() === 'start' ? 'start' : 'center',
            'padding-left': lift() === 'start' ? 'calc(3% + 24px)' : '0',
            position: 'absolute',
          }}
        >
          <div
            style={{
              'max-width': props.liftMaxWidth ?? '560px',
              position: 'relative',
              width: '100%',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(70% 70% at 50% 50%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)',
                inset: '-14% -10%',
                'pointer-events': 'none',
                position: 'absolute',
                'z-index': 0,
              }}
            />
            <div
              style={{
                filter: 'drop-shadow(0 40px 80px rgb(0 0 0 / 0.55))',
                position: 'relative',
                'z-index': 1,
              }}
            >
              {props.children}
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

const BuildsSpotlight = () => (
  <CrmSpotlight liftMaxWidth="600px">
    <BuildsThemselvesGraphic />
  </CrmSpotlight>
);
const DiscussionSpotlight = () => (
  <CrmSpotlight liftMaxWidth="520px" lift="start">
    <DiscussionGraphic />
  </CrmSpotlight>
);

const buildsBlock: LoopsFeatureBlock = {
  label: 'CRM',
  headline: (
    <>
      Built from your email,
      <br />
      automatically.
    </>
  ),
  description:
    'Every thread, introduction, and reply creates contacts and companies — no import, no data entry.',
  href: 'https://docs.macro.com/product/crm',
  heroShot: BuildsSpotlight,
  heroBare: true,
};

const discussionBlock: LoopsFeatureBlock = {
  label: 'CRM',
  headline: (
    <>
      Full context lives
      <br />
      on the record.
    </>
  ),
  description:
    'Emails, calls, notes, and tasks thread directly to each contact so nothing gets buried.',
  href: 'https://docs.macro.com/product/crm',
  heroShot: DiscussionSpotlight,
  heroBare: true,
};

const agentBlock: LoopsFeatureBlock = {
  label: 'CRM',
  headline: (
    <>
      An agent that keeps
      <br />
      everything current.
    </>
  ),
  description:
    'Ask about any deal, let the agent patch stale fields, and surface at-risk contacts before you ask.',
  href: 'https://docs.macro.com/product/crm',
  heroShot: CrmAgentSpotlight,
  heroBare: true,
};

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'Salesforce', 'HubSpot', 'Attio'];

const comparisonRows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  {
    feature: 'Builds itself from your email (no data entry)',
    cells: [true, false, 'partial', 'partial'],
  },
  {
    feature: 'Automatic company enrichment',
    cells: [true, 'partial', true, true],
  },
  {
    feature: 'Discussion threads on every record',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: '@mention records in docs, tasks & chat',
    cells: [true, false, false, false],
  },
  {
    feature: 'One customer view across email, calls, docs & tasks',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Built-in email, calls, docs & tasks',
    cells: [true, 'partial', 'partial', false],
  },
  {
    feature: 'Agents with full-workspace context',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Unified search across everything',
    cells: [true, false, false, false],
  },
  { feature: 'Open source (AGPLv3)', cells: [true, false, false, false] },
  { feature: 'Price / seat / month', cells: ['$40', '$165', '$90', '$34'] },
];

function CheckMark() {
  return (
    <svg
      width="16"
      height="13"
      viewBox="0 0 16 13"
      aria-label="Yes"
      role="img"
      style={{ display: 'block' }}
    >
      <path
        d="M1.5 6.5 L5.8 11 L14.5 1.6"
        fill="none"
        stroke="var(--a0)"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
function PartialMark() {
  return (
    <span
      aria-label="Partial"
      role="img"
      style={{
        'background-color': 'color-mix(in srgb, var(--c4) 55%, transparent)',
        'border-radius': '999px',
        display: 'block',
        height: '4px',
        width: '14px',
      }}
    />
  );
}
function CrossMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      aria-label="No"
      role="img"
      style={{ display: 'block', opacity: 0.45 }}
    >
      <path
        d="M2 2 L11 11 M11 2 L2 11"
        fill="none"
        stroke="var(--c4)"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function ComparisonCell(props: { value: Cell; macro: boolean }) {
  const isPrice = () =>
    typeof props.value === 'string' && props.value !== 'partial';
  return (
    <div
      style={{
        'align-items': 'center',
        display: 'flex',
        'justify-content': 'center',
        'min-height': '22px',
      }}
    >
      <Show
        when={isPrice()}
        fallback={
          <Show
            when={props.value === true}
            fallback={
              <Show when={props.value === 'partial'} fallback={<CrossMark />}>
                <PartialMark />
              </Show>
            }
          >
            <CheckMark />
          </Show>
        }
      >
        <span
          style={{
            color: props.macro ? 'var(--a0)' : 'var(--c2)',
            'font-family': 'rajdhani, body',
            'font-size': mobile() ? '13px' : '15px',
            'font-weight': '700',
            'letter-spacing': '0.02em',
            'white-space': 'nowrap',
          }}
        >
          {props.value as string}
        </span>
      </Show>
    </div>
  );
}

function ComparisonTable() {
  const gridTemplate = () =>
    mobile()
      ? 'minmax(160px, 1.6fr) repeat(4, minmax(58px, 1fr))'
      : 'minmax(0, 2.4fr) repeat(4, minmax(0, 1fr))';

  const headerCellStyle = (macro: boolean): JSX.CSSProperties => ({
    'align-items': 'center',
    'background-color': macro
      ? 'color-mix(in srgb, var(--a0) 12%, var(--b0))'
      : 'transparent',
    color: macro ? 'var(--a0)' : 'var(--c2)',
    display: 'flex',
    'font-family': 'rajdhani, body',
    'font-size': mobile() ? '12px' : '15px',
    'font-weight': '700',
    'justify-content': 'center',
    'letter-spacing': '0.04em',
    'line-height': 1.1,
    padding: mobile() ? '14px 6px' : '18px 12px',
    'text-align': 'center',
    'text-transform': 'uppercase',
  });

  const rowBorder = '1px solid color-mix(in srgb, var(--c4) 10%, transparent)';
  const tableBorder =
    '1px solid color-mix(in srgb, var(--c4) 10%, transparent)';

  return (
    <div
      style={{
        'overflow-x': mobile() ? 'auto' : 'visible',
        width: '100%',
        'min-width': '0',
        'max-width': '100%',
        '-webkit-overflow-scrolling': 'touch',
      }}
    >
      <div
        style={{
          border: tableBorder,
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': gridTemplate(),
          'min-width': mobile() ? '520px' : 'auto',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            'background-color': 'var(--b0)',
            'border-bottom': rowBorder,
          }}
        />
        <For each={comparisonColumns}>
          {(col, index) => (
            <div
              style={{
                ...headerCellStyle(index() === 0),
                'border-bottom':
                  index() === 0 ? '1px solid var(--a0)' : rowBorder,
              }}
            >
              {col}
            </div>
          )}
        </For>

        <For each={comparisonRows}>
          {(row, rowIndex) => (
            <>
              <div
                style={{
                  'align-items': 'center',
                  'background-color': 'var(--b0)',
                  'border-bottom':
                    rowIndex() === comparisonRows.length - 1 ? '0' : rowBorder,
                  color: 'var(--c2)',
                  display: 'flex',
                  'font-size': mobile() ? '13px' : '16px',
                  'line-height': 1.25,
                  padding: mobile() ? '13px 12px 13px 14px' : '15px 20px',
                  position: mobile() ? 'sticky' : 'static',
                  left: mobile() ? '0' : 'auto',
                  'z-index': mobile() ? 1 : 'auto',
                }}
              >
                {row.feature}
              </div>
              <For each={row.cells}>
                {(cell, cellIndex) => (
                  <div
                    style={{
                      'align-items': 'center',
                      'background-color':
                        cellIndex() === 0
                          ? 'color-mix(in srgb, var(--a0) 7%, var(--b0))'
                          : 'var(--b0)',
                      'border-bottom':
                        rowIndex() === comparisonRows.length - 1
                          ? '0'
                          : rowBorder,
                      'border-left':
                        cellIndex() === 0
                          ? '1px solid color-mix(in srgb, var(--a0) 28%, transparent)'
                          : '0',
                      'border-right':
                        cellIndex() === 0
                          ? '1px solid color-mix(in srgb, var(--a0) 28%, transparent)'
                          : '0',
                      display: 'flex',
                      'justify-content': 'center',
                      padding: mobile() ? '13px 6px' : '15px 12px',
                    }}
                  >
                    <ComparisonCell value={cell} macro={cellIndex() === 0} />
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

function ComparisonSection() {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <section
      aria-label="How Macro CRM compares"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '28px' : '40px',
        'justify-items': 'center',
        'min-width': '0',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '14px',
          'justify-items': 'center',
          'max-width': '720px',
          'text-align': 'center',
        }}
      >
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': mobile() ? '12px' : '16px',
            'letter-spacing': '0.08em',
            'text-transform': 'uppercase',
          }}
        >
          The comparison
        </span>
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '32px' : '44px',
            'font-weight': '410',
            'letter-spacing': '-0.015em',
            'line-height': 1.1,
            margin: 0,
          }}
        >
          Less setup. More signal.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': mobile() ? '16px' : '19px',
            'line-height': 1.45,
            margin: 0,
            'max-width': '560px',
          }}
        >
          Salesforce and HubSpot need admins to keep data clean. Macro's CRM
          maintains itself.
        </p>
      </div>
      <div
        style={{
          width: '100%',
          'max-width': '920px',
          'min-width': '0',
          position: 'relative',
        }}
      >
        <div
          style={{
            'max-height': expanded() ? 'none' : mobile() ? '320px' : '420px',
            overflow: 'hidden',
          }}
        >
          <ComparisonTable />
        </div>
        <Show when={!expanded()}>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              'align-items': 'flex-end',
              background:
                'linear-gradient(to bottom, transparent 0, var(--b0) 82%)',
              border: '0',
              bottom: '0',
              cursor: 'pointer',
              display: 'flex',
              height: '120px',
              'justify-content': 'center',
              left: '0',
              padding: '0 0 12px',
              position: 'absolute',
              right: '0',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c4)',
                display: 'flex',
                'font-family': "'rajdhani', body",
                'font-size': '11px',
                'font-weight': '700',
                gap: '8px',
                'letter-spacing': '0.1em',
                'text-transform': 'uppercase',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  background: 'var(--b3)',
                  height: '1px',
                  width: '20px',
                }}
              />
              Show more
              <span
                aria-hidden="true"
                style={{
                  background: 'var(--b3)',
                  height: '1px',
                  width: '20px',
                }}
              />
            </span>
          </button>
        </Show>
      </div>
      <div
        style={{
          'align-items': 'center',
          color: 'var(--c4)',
          display: 'flex',
          'flex-wrap': 'wrap',
          gap: mobile() ? '16px' : '24px',
          'justify-content': 'center',
        }}
      >
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <CheckMark /> Full support
        </span>
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <PartialMark /> Partial / limited
        </span>
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <CrossMark /> Not available
        </span>
        <Show when={mobile()}>
          <span
            style={{
              'font-family': 'rajdhani, body',
              'font-size': '11px',
              'letter-spacing': '0.06em',
              opacity: 0.6,
              'text-transform': 'uppercase',
              width: '100%',
              'text-align': 'center',
            }}
          >
            Scroll table sideways →
          </span>
        </Show>
      </div>
      <SectionFaq items={faqItems} embedded />
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const faqItems: { q: string; a: JSX.Element }[] = [
  {
    q: 'Do I have to enter data into the CRM?',
    a: (
      <>
        No, that's the whole point. Because your team's email already flows
        through Macro, contact and company records are created and kept up to
        date automatically as you work. There's no importer to run and no fields
        to type in. Most CRMs die because nobody fills them in. Macro's fills
        itself.
      </>
    ),
  },
  {
    q: 'How are companies and contacts created?',
    a: (
      <>
        When someone on your team emails an external contact, Macro creates a
        contact record and groups contacts into companies by email domain, so
        everyone <code>@acme.com</code> rolls up to one Acme record. Each
        contact tracks its first and last interaction, and generic vendor / tool
        domains are filtered out so the CRM stays focused on your actual
        customers.
      </>
    ),
  },
  {
    q: 'What is automatic enrichment?',
    a: (
      <>
        New companies are enriched with public data: name, description, logo,
        website, industry, headcount, funding, location, and social links. A
        useful record exists the moment the company appears, without anyone
        touching it.
      </>
    ),
  },
  {
    q: 'How do discussion threads work?',
    a: (
      <>
        Every company and contact has its own discussion thread, so deal notes
        and context live on the record itself instead of a side channel. Threads
        work just like Macro channels, with inline replies, the same rich
        editor, and @mentions of people, docs, tasks, and other records.
      </>
    ),
  },
  {
    q: 'Can I @mention a company or contact elsewhere?',
    a: (
      <>
        Yes. Like everything in Macro, CRM records are blocks. @mention a
        company or contact in a doc, task, or channel and it becomes a live,
        traceable link. From the record you can see everywhere it's been
        referenced across channels, docs, and calls. Note that sharing of CRM
        records is controlled by your team, so @mentioning a record doesn't
        change who can see it.
      </>
    ),
  },
  {
    q: 'Can agents use my CRM?',
    a: (
      <>
        Yes. Agents use your CRM as context like the rest of your team memory.
        Ask "what's the latest with Hartwell?" and the agent reads the company's
        emails, calls, tasks, and docs to answer, instead of you stitching the
        story together across tools.
      </>
    ),
  },
  {
    q: 'Is the CRM available yet, and is it open source?',
    a: (
      <>
        CRM is rolling out now. If you don't see the <strong>Companies</strong>{' '}
        view in your workspace yet, it hasn't reached your account. And like the
        rest of Macro, it's fully open source under the AGPLv3, not "open core."
        To build on Macro under a different license, contact{' '}
        <a href="mailto:licensing@macro.com">licensing@macro.com</a>.
      </>
    ),
  },
];

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

function CrmFinalCta() {
  return (
    <section
      aria-label="Get started"
      style={{
        'align-items': mobile() ? 'start' : 'center',
        display: 'grid',
        gap: mobile() ? '24px' : '28px',
        'justify-items': mobile() ? 'start' : 'center',
        'text-align': mobile() ? 'left' : 'center',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '14px' : '16px',
          'justify-items': mobile() ? 'start' : 'center',
          'max-width': '585px',
        }}
      >
        <h2
          style={{
            'font-family': 'display',
            'font-size': mobile() ? '38px' : '48px',
            'font-weight': '420',
            'letter-spacing': '-0.015em',
            'line-height': 1.08,
            margin: '0',
          }}
        >
          Your CRM, zero
          <br />
          maintenance required.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': 'body',
            'font-size': mobile() ? '17px' : '19px',
            'font-weight': '400',
            'line-height': 1.55,
            margin: '0',
          }}
        >
          Connect your Google Workspace and Macro builds your company and
          contact records from the emails you're already sending — no setup
          required.
        </p>
      </div>
      <ConnectGoogleButton buttonName="crm_final_connect_google" large />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteCrm: Component = () => {
  setPageSeo({
    title: 'Macro CRM — The Self-Building CRM',
    description:
      'Macro CRM builds itself from your email. Contacts, companies, enrichment, discussion threads, and an AI agent that keeps everything current — no data entry required.',
    path: '/crm',
  });

  return (
    <div
      lang="en"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-columns': 'minmax(0, 1fr)',
        gap: '0',
        'padding-bottom': mobile() ? '48px' : '64px',
        width: '100%',
      }}
    >
      <style>{`
        @media (hover) {
          .crm-cta-button:hover { transform: scale(1.02); }
        }
        ${loopsFeatureHoverStyles()}
      `}</style>

      {/* Hero */}
      <div
        style={{
          display: 'flow-root',
          position: 'relative',
          width: '100%',
          'min-width': '0',
        }}
      >
        <HomeHeroBackdrop subtle neutral />

        <section
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': mobile() ? 'start' : 'center',
            'padding-bottom': '0',
            'padding-inline': mobile() ? '18px' : '24px',
            'padding-top': mobile() ? '96px' : '128px',
            position: 'relative',
            'z-index': 1,
            width: '100%',
          }}
        >
          <div
            style={{
              'box-sizing': 'border-box',
              display: 'grid',
              gap: mobile() ? '24px' : '28px',
              'justify-items': mobile() ? 'start' : 'center',
              'max-width': mobile() ? '100%' : '720px',
              'text-align': mobile() ? 'left' : 'center',
              width: '100%',
            }}
          >
            <HeroEyebrow label="Macro CRM" mobile={mobile} />
            <h1
              style={{
                'font-family': 'display',
                'font-size': mobile() ? 'clamp(44px, 12vw, 60px)' : '52.36px',
                'font-weight': '380',
                'letter-spacing': '-0.012em',
                'line-height': 1.12,
                margin: '0',
                'white-space': mobile() ? 'normal' : 'nowrap',
              }}
            >
              A CRM that builds itself.
            </h1>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'body',
                'font-size': mobile() ? '16.5px' : '23px',
                'font-weight': '400',
                'line-height': 1.5,
                margin: '0',
                'max-width': mobile() ? '34ch' : '600px',
              }}
            >
              Contacts, companies, enrichment, and deal context — all built from
              the emails your team is already sending.
            </p>
            <div
              style={{
                'align-items': 'center',
                display: 'flex',
                'flex-direction': mobile() ? 'column' : 'row',
                gap: mobile() ? '12px' : '14px',
                'justify-content': mobile() ? 'flex-start' : 'center',
                'margin-top': mobile() ? '4px' : '8px',
                width: mobile() ? '100%' : 'auto',
              }}
            >
              <ConnectGoogleButton buttonName="crm_hero_connect_google" />
            </div>
          </div>
        </section>

        {/* App-shell preview (collapsible left rail) opened on the CRM section,
            matching the other feature-page heroes. */}
        <HomeAppPreview
          mobile={mobile}
          defaultSection="crm"
          showStrip={false}
          fadeBottom
          keepSidebarCollapsed
        />
      </div>

      <HomeSectionRule />

      {/* 4-tile feature grid */}
      <CrmFeatureGrid />

      <HomeSectionRule />

      {/* Builds from email spotlight */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={buildsBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      <HomeSectionRule />

      {/* Discussion & context spotlight */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={discussionBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      <HomeSectionRule />

      {/* Agent spotlight */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={agentBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      {/* 2×2 bento of CRM UI */}
      <CrmUiGrid />

      {/* Comparison */}
      <ComparisonSection />

      <HomeSectionRule />

      {/* Final CTA */}
      <div
        style={{
          'padding-block': mobile() ? '52px' : '68px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <CrmFinalCta />
      </div>

      {/* Footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/crm" footerOnly />
      </div>
    </div>
  );
};
