import { type Component, createUniqueId } from 'solid-js';

// Each post's card art is simply a single logo mark (the competitor's for
// comparisons, the topic's for engineering posts), tinted with the accent.
// Paths are brand marks extracted from the switch-to-macro graphics.

const NOTION_PATH =
  'M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z';

const SLACK_PATH =
  'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z';

const LINEAR_PATH =
  'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z';

const GRAPHQL_PATH =
  'M12.002 0a2.138 2.138 0 1 0 0 4.277 2.138 2.138 0 1 0 0-4.277zm8.54 4.931a2.138 2.138 0 1 0 0 4.277 2.138 2.138 0 1 0 0-4.277zm0 9.862a2.138 2.138 0 1 0 0 4.277 2.138 2.138 0 1 0 0-4.277zm-8.54 4.931a2.138 2.138 0 1 0 0 4.276 2.138 2.138 0 1 0 0-4.276zm-8.542-4.93a2.138 2.138 0 1 0 0 4.276 2.138 2.138 0 1 0 0-4.277zm0-9.863a2.138 2.138 0 1 0 0 4.277 2.138 2.138 0 1 0 0-4.277zm8.542-3.378L2.953 6.777v10.448l9.049 5.224 9.047-5.224V6.777zm0 1.601 7.66 13.27H4.34zm-1.387.371L3.97 15.037V7.363zm2.774 0 6.646 3.838v7.674zM5.355 17.44h13.293l-6.646 3.836z';

// Padlock mark for the MFS permissions/sharing post (drawn by hand; the
// keyhole subpath winds opposite the body so it punches out as a hole).
const LOCK_PATH =
  'M7,11 V7.5 a5,5 0 0 1 10,0 V11 H14.6 V7.5 a2.6,2.6 0 0 0 -5.2,0 V11 Z M5.5,11 h13 a1.8,1.8 0 0 1 1.8,1.8 v7.4 a1.8,1.8 0 0 1 -1.8,1.8 h-13 a1.8,1.8 0 0 1 -1.8,-1.8 v-7.4 a1.8,1.8 0 0 1 1.8,-1.8 Z M12,14.3 a1.7,1.7 0 1 0 0,3.4 a1.7,1.7 0 1 0 0,-3.4 Z';

// The same padlock with its shackle swung open, for the open source post.
const OPEN_LOCK_PATH =
  'M9.5,11 V7.5 a5,5 0 0 1 10,0 h-2.4 a2.6,2.6 0 0 0 -5.2,0 V11 Z M5.5,11 h13 a1.8,1.8 0 0 1 1.8,1.8 v7.4 a1.8,1.8 0 0 1 -1.8,1.8 h-13 a1.8,1.8 0 0 1 -1.8,-1.8 v-7.4 a1.8,1.8 0 0 1 1.8,-1.8 Z M12,14.3 a1.7,1.7 0 1 0 0,3.4 a1.7,1.7 0 1 0 0,-3.4 Z';

// A collaborator's pointer, for the post about AI agents editing as document peers.
const CURSOR_PATH =
  'M5,2.5 L5,19 L9.4,14.6 L12.4,21 L15,19.8 L12,13.6 L18,13.6 Z';

// Config sliders for the Doppler post: three bars, each with a knob at a
// different position. Knobs wind the same way as the bars so they union.
const SLIDERS_PATH =
  'M3,5.2 h18 v1.6 H3 Z M8,3.4 a2.6,2.6 0 1 1 0,5.2 a2.6,2.6 0 1 1 0,-5.2 Z M3,11.2 h18 v1.6 H3 Z M15,9.4 a2.6,2.6 0 1 1 0,5.2 a2.6,2.6 0 1 1 0,-5.2 Z M3,17.2 h18 v1.6 H3 Z M10,15.4 a2.6,2.6 0 1 1 0,5.2 a2.6,2.6 0 1 1 0,-5.2 Z';

// Envelope for the Gmail quota post: an outlined body (the inner subpath winds
// opposite so it punches out) with the flap drawn back inside the hole.
const ENVELOPE_PATH =
  'M2.5,5 H21.5 V19 H2.5 Z M4.1,6.6 V17.4 H19.9 V6.6 Z M4.1,6.6 L12,12.4 L19.9,6.6 L19.9,8.8 L12,14.6 L4.1,8.8 Z';

const SUPERHUMAN_PATH =
  'M22.3826 6.22157C22.1402 3.17618 19.718 0.759886 16.6746 0.523503C13.2525 0.259071 9.81644 0.261063 6.3944 0.533481C3.34902 0.773957 0.932736 3.19625 0.696353 6.24163C0.431921 9.66367 0.433913 13.0997 0.706346 16.5217C0.948815 19.5671 3.3711 21.9834 6.4145 22.2198C9.83653 22.4843 13.2725 22.4823 16.6946 22.2098C19.74 21.9673 22.1563 19.545 22.3927 16.5018C22.6572 13.0797 22.6552 9.6436 22.3826 6.22157ZM11.5715 3.84741C12.8036 3.84741 13.8014 4.84317 13.8014 6.07133C13.8014 7.29949 12.8036 8.29525 11.5715 8.29525C10.3393 8.29525 9.34159 7.29949 9.34159 6.07133C9.34159 4.84317 10.3393 3.84741 11.5715 3.84741ZM15.779 18.4993H15.781L11.9101 16.3796C11.6997 16.2634 11.4432 16.2634 11.2329 16.3796L7.36202 18.4993C6.73891 18.8399 6.0598 18.1487 6.41838 17.5395L10.9664 9.83397C11.2369 9.37517 11.9041 9.37517 12.1745 9.83397L16.7226 17.5395C17.0812 18.1487 16.4041 18.8399 15.779 18.4993Z';

const CLICKUP_PATH =
  'M2 18.439l3.69-2.828c1.961 2.56 4.044 3.739 6.363 3.739 2.307 0 4.33-1.166 6.203-3.704L22 18.405C19.298 22.065 15.941 24 12.053 24 8.178 24 4.788 22.078 2 18.439zM12.036 5.612l-6.58 5.666-3.098-3.598L12.05 0l9.634 7.688-3.11 3.588z';

function Logo(props: { height: string; viewBox?: string; d: string }) {
  const id = createUniqueId();
  return (
    <svg
      viewBox={props.viewBox ?? '0 0 24 24'}
      aria-hidden="true"
      style={{ display: 'block', height: props.height, width: 'auto' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop
            offset="0%"
            stop-color="oklch(from var(--a0) calc(l + 0.06) calc(c * 0.9) h)"
          />
          <stop
            offset="52%"
            stop-color="oklch(from var(--a0) calc(l + 0.01) calc(c * 0.9) h)"
          />
          <stop
            offset="100%"
            stop-color="oklch(from var(--a0) calc(l - 0.04) calc(c * 0.9) h)"
          />
        </linearGradient>
      </defs>
      <path d={props.d} fill={`url(#${id})`} />
    </svg>
  );
}

const Notion = (p: { height: string }) => (
  <Logo height={p.height} d={NOTION_PATH} />
);
const Graphql = (p: { height: string }) => (
  <Logo height={p.height} d={GRAPHQL_PATH} />
);
const Lock = (p: { height: string }) => (
  <Logo height={p.height} d={LOCK_PATH} />
);
const OpenLock = (p: { height: string }) => (
  <Logo height={p.height} d={OPEN_LOCK_PATH} />
);
const Cursor = (p: { height: string }) => (
  <Logo height={p.height} d={CURSOR_PATH} />
);
const Sliders = (p: { height: string }) => (
  <Logo height={p.height} d={SLIDERS_PATH} />
);
const Envelope = (p: { height: string }) => (
  <Logo height={p.height} d={ENVELOPE_PATH} />
);
const Slack = (p: { height: string }) => (
  <Logo height={p.height} d={SLACK_PATH} />
);
const Linear = (p: { height: string }) => (
  <Logo height={p.height} d={LINEAR_PATH} />
);
const Superhuman = (p: { height: string }) => (
  <Logo height={p.height} viewBox="0 0 23 23" d={SUPERHUMAN_PATH} />
);
const ClickUp = (p: { height: string }) => (
  <Logo height={p.height} d={CLICKUP_PATH} />
);

export const postGraphics: Record<string, Component<{ height: string }>> = {
  'graphql-cache': Graphql,
  'mfs-sharing': Lock,
  'ai-editing-agents': Cursor,
  'doppler-config': Sliders,
  'gmail-rate-limits': Envelope,
  'notion-alternative': Notion,
  'slack-alternative': Slack,
  'linear-alternative': Linear,
  'superhuman-alternative': Superhuman,
  'clickup-alternative': ClickUp,
  'why-macro-is-open-source': OpenLock,
};
