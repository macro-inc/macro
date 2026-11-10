import Play from '@icon/system/fill/play-fill.svg';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import Check from '@icon/system/regular/check.svg';
import Minus from '@icon/system/regular/minus.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { isServer } from 'solid-js/web';
import markDesyncPlaceholder from '../../assets/mark-desync-placeholder.jpg';
import { FeaturePageFaq } from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import { SavingsCalculator } from '../../features/marketing/components/pricing/SavingsCalculator';
import {
  ProductHero,
  ProductPage,
} from '../../features/marketing/components/product/ProductPage';
import { APP_BASE_URL } from '../utils/utilBaseUrl';
import { ctaHref, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';
import './RoutePricing.css';

const plans = [
  {
    key: 'free',
    name: 'Free',
    price: '$0',
    note: 'Start here.',
    cta: 'Start for free',
    event: 'pricing_free_connect_google',
    features: [
      'Gemini Flash · Limited AI usage',
      '2 email accounts · 5 GB storage',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$40',
    note: '30 days free',
    cta: 'Try Pro',
    event: 'pricing_paid_connect_google',
    features: [
      'All AI models · Standard usage',
      'Unlimited email accounts · 100 GB storage',
      'Calls, recording, and transcription',
    ],
  },
  {
    key: 'max',
    name: 'Max',
    price: '$200',
    note: '10× Pro usage',
    cta: 'Get Max',
    event: 'pricing_max_connect_google',
    features: [
      'All AI models · 10× Pro usage',
      'Unlimited email accounts · 1 TB storage',
      'Calls, transcription, and priority support',
    ],
  },
] as const;
type CellValue = boolean | string;

const comparisonGroups: Array<{
  group: string;
  rows: Array<{
    label: string;
    free: CellValue;
    pro: CellValue;
    max: CellValue;
  }>;
}> = [
  {
    group: 'AI and agents',
    rows: [
      { label: 'AI usage', free: 'Limited', pro: 'Standard', max: '10× Pro' },
      { label: 'AI models', free: 'Gemini Flash', pro: 'All', max: 'All' },
      {
        label: 'Agents with workspace context',
        free: true,
        pro: true,
        max: true,
      },
    ],
  },
  {
    group: 'Workspace',
    rows: [
      {
        label: 'Connected email accounts',
        free: 'Up to 2',
        pro: 'Unlimited',
        max: 'Unlimited',
      },
      { label: 'Storage', free: '5 GB', pro: '100 GB', max: '1 TB' },
      {
        label: 'Calls, recording, and transcription',
        free: false,
        pro: true,
        max: true,
      },
    ],
  },
  {
    group: 'Branding and teams',
    rows: [
      {
        label: '"Sent with Macro" email footer',
        free: 'Added',
        pro: 'Removed',
        max: 'Removed',
      },
      {
        label: 'Team-level memory for your agents',
        free: true,
        pro: true,
        max: true,
      },
      { label: 'Priority support', free: false, pro: false, max: true },
    ],
  },
];

const faqItems: Array<{ q: string; a: JSX.Element }> = [
  {
    q: "What's the main purpose of Macro?",
    a: (
      <>
        Macro combines email, chat, documents, tasks, calls, and agents. Read
        them in one inbox, search across the workspace, and use agents to edit
        documents, draft replies, and update tasks. Documents use CRDTs for live
        collaboration and offline sync.
      </>
    ),
  },
  {
    q: 'How does Macro compare to Notion?',
    a: (
      <>
        Macro is a replacement for Notion. Notion is built on markdown and
        databases; Macro has purpose-built modules for each job, plus native
        email, messaging, and file storage. You can still{' '}
        <a href="/docs/switch-to-macro#import-from-notion">
          import your Notion workspace
        </a>{' '}
        with the dedicated importer, or keep it connected through MCP. See our{' '}
        <a href="https://youtu.be/hyU1XYmxkYM" target="_blank" rel="noreferrer">
          comparison video
        </a>
        .
      </>
    ),
  },
  {
    q: 'How does Macro compare to Superhuman?',
    a: (
      <>
        Macro Mail uses familiar J / K / E shortcuts, combines your email
        accounts in one inbox, and shares that inbox with messages, @mentions,
        tasks, and agent responses. Agents can search indexed email, draft
        replies, and share threads with your team.
      </>
    ),
  },
  {
    q: 'How does Macro compare to Slack?',
    a: (
      <>
        Macro Chat shows replies inline and treats conversations as inbox items
        you can mark done. When you can share a document or email thread,
        @mentioning it in a channel grants access to that channel. Agents
        participate in channels and can read the referenced work.
      </>
    ),
  },
  {
    q: 'Does Macro have its own email or integrate with my email?',
    a: (
      <>
        Macro Mail is an email client, not an email server. We integrate with
        your existing Google Workspace or Gmail account. Outlook and custom
        IMAP/SMTP are a popular request and are coming soon.
      </>
    ),
  },
  {
    q: 'Can I self-host Macro?',
    a: (
      <>
        Yes, under our AGPL license, though the hosted version is our primary
        focus today. The hosted version has the iOS app, Apple/Google/GitHub
        approvals, runs on AWS, and maintains a SOC 2 Type II audit. For HIPAA,
        FedRAMP, or other needs, contact{' '}
        <a href="mailto:self-host@macro.com">self-host@macro.com</a>.
      </>
    ),
  },
  {
    q: 'Is Macro fully open source? What is the license?',
    a: (
      <>
        Yes — fully open source, not "open core". As of May 31 2026 we moved
        from BSL to the AGPLv3, a copyleft license, meaning derivative works
        must also be open source. To build on Macro under a different (e.g.
        closed-source) license, contact{' '}
        <a href="mailto:licensing@macro.com">licensing@macro.com</a>.
      </>
    ),
  },
  {
    q: 'How do you make money if Macro is open source?',
    a: (
      <>
        From our hosted version, like any other SaaS or AI product, and from
        those who build on top of Macro and prefer a license other than the
        AGPLv3.
      </>
    ),
  },
  {
    q: 'How do teams work in Macro? Do I need a team?',
    a: (
      <>
        Macro works great solo or as a team, and pricing is the same either way.
        Teams share email, tasks, documents, and calls through workspace
        permissions. Agents can search and read the work you have access to, and
        use memory built from your workspace activity. Team subscriptions
        require a paid seat for every member, and each seat can be Pro or Max.
      </>
    ),
  },
  {
    q: 'What happens if I hit my AI usage limit?',
    a: (
      <>
        Every plan includes a monthly amount of AI usage. Free has a limited
        allowance for trying Macro, Pro covers standard everyday use, and Max
        includes 10× Pro's usage for heavy agent work. If you reach your limit,
        upgrade from billing settings: Free to Pro, or Pro to Max.
      </>
    ),
  },
  {
    q: 'How do you use my data?',
    a: (
      <>
        Workspace access follows your sharing permissions. For details on data
        collection, processing, retention, and AI handling, see our{' '}
        <a href="/privacy">privacy policy</a> and{' '}
        <a href="/terms">terms of service</a> for full details.
      </>
    ),
  },
  {
    q: 'Have you raised venture capital?',
    a: (
      <>
        Yes — about $30M led by a16z, with participation from BoxGroup, 3kVC,
        and others.
      </>
    ),
  },
];

function PlanComparison() {
  return (
    <details class="pricing-comparison">
      <summary>
        <span>Compare every plan</span>
        <span class="pricing-disclosure-mark" aria-hidden="true">
          +
        </span>
      </summary>
      <table>
        <caption class="pricing-visually-hidden">
          Free, Pro, and Max plan comparison
        </caption>
        <thead>
          <tr>
            <th scope="col">Plan details</th>
            <For each={plans}>{(plan) => <th scope="col">{plan.name}</th>}</For>
          </tr>
        </thead>
        <For each={comparisonGroups}>
          {(group) => (
            <tbody>
              <tr class="pricing-comparison-group">
                <th colSpan={4} scope="colgroup">
                  {group.group}
                </th>
              </tr>
              <For each={group.rows}>
                {(row) => (
                  <tr>
                    <th scope="row">{row.label}</th>
                    <For each={plans}>
                      {(plan) => {
                        const value = row[plan.key];
                        return (
                          <td>
                            {typeof value === 'string' ? (
                              value
                            ) : value ? (
                              <Check role="img" aria-label="Included" />
                            ) : (
                              <Minus role="img" aria-label="Not included" />
                            )}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          )}
        </For>
      </table>
    </details>
  );
}

function CustomerStory() {
  let video!: HTMLVideoElement;
  const [playing, setPlaying] = createSignal(false);
  const local =
    !isServer && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const videoUrl = local
    ? '/video/desync.mp4'
    : new URL('/video/desync.mp4', APP_BASE_URL).toString();
  const play = () =>
    video
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  return (
    <section class="pricing-customer" aria-label="Desync customer story">
      <div>
        <p class="pricing-section-label">Desync runs on Macro</p>
        <blockquote>
          “Macro did not help us get organized. Macro <em>is why</em> we are
          organized.”
        </blockquote>
        <p class="pricing-customer-name">
          Mark Evgenev
          <br />
          <span>Founder/CEO, Desync</span>
        </p>
      </div>
      <div class="pricing-customer-video">
        <video
          ref={video}
          src={videoUrl}
          poster={markDesyncPlaceholder}
          preload="none"
          playsinline
          controls={playing()}
          onEnded={() => setPlaying(false)}
          onError={() => setPlaying(false)}
        />
        <Show when={!playing()}>
          <button
            type="button"
            onClick={play}
            aria-label="Play Desync customer story"
          >
            <Play aria-hidden="true" />
            <span>Watch their story</span>
          </button>
        </Show>
      </div>
    </section>
  );
}

export function RoutePricing() {
  setPageSeo({
    title: 'Pricing — Macro',
    description:
      'Start free. Pro is $40 per seat per month with every AI model and standard usage. Max is $200 per seat per month with 10× Pro usage.',
    path: '/pricing',
  });
  return (
    <ProductPage auraAccent="#b0b0b8">
      <div class="pricing-page">
        <ProductHero
          product="Pricing"
          title="One plan for all your work."
          description="Start free. Upgrade for more AI usage and storage."
        />
        <section class="pricing-plan-list" aria-label="Choose a plan">
          <For each={plans}>
            {(plan) => (
              <article
                class="pricing-plan"
                data-plan={plan.key}
                aria-labelledby={`pricing-plan-${plan.key}`}
              >
                <div class="pricing-plan-name">
                  <h2 id={`pricing-plan-${plan.key}`}>{plan.name}</h2>
                  <p>{plan.note}</p>
                </div>
                <div class="pricing-plan-price">
                  <strong>{plan.price}</strong>
                  <span>per seat / month</span>
                </div>
                <ul>
                  <For each={plan.features}>
                    {(feature) => <li>{feature}</li>}
                  </For>
                </ul>
                <a
                  class={`pricing-plan-cta ${plan.key === 'pro' ? 'site-nav-start' : ''}`}
                  href={ctaHref()}
                  onClick={(event) => handleCtaClick(event, plan.event)}
                >
                  {plan.cta}
                  <ArrowRight aria-hidden="true" />
                </a>
              </article>
            )}
          </For>
          <p class="pricing-included">
            Email, chat, docs, tasks, and agents on every plan.
          </p>
          <PlanComparison />
        </section>
        <section
          class="pricing-calculator-section"
          id="savings"
          aria-labelledby="pricing-savings-title"
        >
          <header>
            <h2 id="pricing-savings-title">Compare your costs.</h2>
            <p>Choose the tools your team pays for and the seats you need.</p>
          </header>
          <SavingsCalculator />
          <a class="pricing-text-link" href="/replace-apps">
            See the apps Macro replaces <ArrowRight aria-hidden="true" />
          </a>
        </section>
        <CustomerStory />
        <FeaturePageFaq
          id="pricing-questions"
          title="Questions about pricing"
          items={faqItems}
        />
        <p class="pricing-open-source">
          Paid plans support Macro’s{' '}
          <a href="https://github.com/macro-inc/macro">
            open-source development
          </a>
          .
        </p>
      </div>
      <HomepageClosing />
    </ProductPage>
  );
}
