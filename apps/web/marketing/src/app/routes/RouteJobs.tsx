import type { Component, JSX } from 'solid-js';
import { SceneComputer } from '../components/scenes/SceneComputer';
import { SceneGlobe } from '../components/scenes/SceneGlobe';
import { breakpoint, viewportWidth } from '../utils/utilBreakpoint';
import { setPageSeo } from '../utils/utilSeo';

const APPLY_EMAIL = 'jobs@macro.com';

const eyebrowStyle = () =>
  ({
    color: 'var(--a0)',
    'font-family': 'rajdhani, body',
    'font-size': viewportWidth() < 700 ? '13px' : '14px',
    'font-weight': '700',
    'letter-spacing': '0.08em',
    'line-height': 1,
    opacity: 0.8,
    'text-transform': 'uppercase',
  }) as const;

const metaStyle = () =>
  ({
    color: 'var(--c4)',
    'font-family': 'rajdhani, body',
    'font-size': viewportWidth() < 700 ? '13px' : '14px',
    'font-weight': '700',
    'letter-spacing': '0.08em',
    'line-height': 1.6,
    opacity: 0.8,
    'text-transform': 'uppercase',
  }) as const;

interface JobCardProps {
  eyebrow: string;
  title: string;
  body: JSX.Element;
  meta: string;
  scene: JSX.Element;
  flip?: boolean;
}

function JobCard(props: JobCardProps) {
  const stacked = () => viewportWidth() < 860;

  return (
    <div
      style={{
        border: '1px solid var(--b2)',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-columns': stacked()
          ? '1fr'
          : props.flip
            ? 'minmax(0, 1fr) minmax(0, 460px)'
            : 'minmax(0, 460px) minmax(0, 1fr)',
        gap: stacked() ? '32px' : '48px',
        'align-items': 'center',
        padding: stacked() ? '28px 22px 32px' : '44px 48px',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: stacked() ? '14px' : '16px',
          order: stacked() ? 1 : props.flip ? 2 : 1,
          'align-content': 'start',
        }}
      >
        <div style={eyebrowStyle()}>{props.eyebrow}</div>
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': stacked() ? '26px' : '30px',
            'font-weight': '450',
            'letter-spacing': '-0.02em',
            'line-height': 1.1,
            margin: '0',
          }}
        >
          {props.title}
        </h2>
        <div
          style={{
            color: 'var(--c4)',
            'font-size': stacked() ? '16px' : '18px',
            'line-height': 1.5,
          }}
        >
          {props.body}
        </div>
        <div style={metaStyle()}>{props.meta}</div>
        <a
          href={`mailto:${APPLY_EMAIL}?subject=${encodeURIComponent(props.title + ' — Application')}`}
          class="hover-color"
          style={{
            'align-items': 'center',
            color: 'var(--c1)',
            display: 'grid',
            gap: '14px',
            'grid-template-columns': 'min-content min-content',
            'margin-top': stacked() ? '6px' : '10px',
            'text-decoration': 'none',
          }}
        >
          <span
            style={{
              'font-family': 'rajdhani, body',
              'font-size': stacked() ? '14px' : '15px',
              'font-weight': '700',
              'letter-spacing': '0.1em',
              'line-height': 1,
              'text-transform': 'uppercase',
              'white-space': 'nowrap',
            }}
          >
            Apply now
          </span>
          <span
            aria-hidden="true"
            style={{
              'background-color': 'var(--a0)',
              height: '1px',
              'margin-top': '1px',
              opacity: 0.8,
              width: stacked() ? '72px' : '96px',
            }}
          />
        </a>
      </div>

      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          'align-items': 'center',
          'justify-self': 'center',
          'min-width': '0',
          'max-width': stacked() ? '270px' : 'none',
          order: stacked() ? 0 : props.flip ? 1 : 2,
          width: '100%',
        }}
      >
        {props.scene}
      </div>
    </div>
  );
}

export const RouteJobs: Component = () => {
  setPageSeo({
    title: 'Jobs at Macro',
    description:
      'Join the team building Macro, the unified workspace for messages, docs, tasks, calls, and email. Open roles in NYC and Toronto, including software engineering.',
    path: '/jobs',
  });

  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: breakpoint() ? '20px' : '24px',
        'justify-items': 'center',
        'padding-top': breakpoint() ? '90px' : '110px',
        width: '100%',
      }}
    >
      <section
        style={{
          display: 'grid',
          gap: breakpoint() ? '16px' : '20px',
          'justify-items': 'center',
          'max-width': '640px',
          'padding-bottom': breakpoint() ? '20px' : '36px',
          'text-align': 'center',
        }}
      >
        <div style={eyebrowStyle()}>We're hiring</div>
        <h1
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': breakpoint() ? '38px' : '50px',
            'font-weight': '450',
            'letter-spacing': '-0.035em',
            'line-height': breakpoint() ? 1.04 : 1,
            margin: '0',
            'text-wrap': 'balance',
          }}
        >
          Help us rebuild the office suite.
        </h1>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': breakpoint() ? '17px' : '20px',
            'line-height': 1.45,
            margin: '0',
            'max-width': '520px',
            'text-wrap': 'balance',
          }}
        >
          We are a small, engineering-led team in NYC and Toronto, obsessed with
          fast, keyboard-driven software.
        </p>
      </section>

      <JobCard
        eyebrow="Engineering"
        title="Software Engineer"
        body={
          <>
            If you love building from the ground up, working with high autonomy,
            and sweating the details, we want to hear from you. We build with
            Rust, TypeScript, and SolidJS.
          </>
        }
        meta="NYC / Toronto · Full-time · Hybrid"
        scene={<SceneComputer />}
      />

      <JobCard
        eyebrow="Everything else"
        title="General Application"
        body={
          <>
            We're not just looking for engineers. If you're a designer who
            thinks in systems, a writer who codes, or a community builder who
            gets open source, we value raw talent and unconventional thinking
            over credentials.
          </>
        }
        meta="NYC / Toronto · Various roles"
        scene={<SceneGlobe />}
        flip
      />
    </div>
  );
};
