import { createUniqueId, For, Match, Switch } from 'solid-js';
import type { TutorialVideoId } from '../../core/tutorial-videos';
import { wallpapers } from '../TutorialWallpaper';

/** The small leader lines and floating labels used in Paper's View showcase. */
function Callout(props: {
  x: number;
  y: number;
  label: string;
  below?: boolean;
  distance?: number;
}) {
  const width = () => props.label.length * 12 + 42;
  const distance = () => props.distance ?? (props.below ? 140 : 160);
  return (
    <g transform={`translate(${props.x} ${props.y})`}>
      <path
        d={`M0 0v${props.below ? distance() : -distance()}`}
        stroke="#ffffff60"
      />
      <circle r="11" fill="#ffffff20" />
      <circle r="5" fill="#ededed" />
      <rect
        x={-width() / 2}
        y={props.below ? distance() : -distance() - 44}
        width={width()}
        height="44"
        rx="22"
        fill="#19191b"
        stroke="#ffffff25"
      />
      <text
        y={props.below ? distance() + 28 : -distance() - 16}
        text-anchor="middle"
        fill="#ededed"
        font-size="21"
        font-weight="450"
      >
        {props.label}
      </text>
    </g>
  );
}

function ItemIcon(props: {
  x: number;
  y: number;
  kind: 'task' | 'doc' | 'chat' | 'mail';
  color?: string;
}) {
  return (
    <g
      transform={`translate(${props.x} ${props.y})`}
      fill="none"
      stroke={props.color ?? '#b6b5bf'}
      stroke-width="2.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    >
      <Switch>
        <Match when={props.kind === 'task'}>
          <circle cx="16" cy="16" r="14" />
          <path d="m9 16 5 5 10-11" />
        </Match>
        <Match when={props.kind === 'doc'}>
          <path d="M7 2h13l7 7v20H7zM20 2v8h7M12 17h10M12 23h10" />
        </Match>
        <Match when={props.kind === 'chat'}>
          <path d="M4 4h24v20H13l-9 6zM10 11h12M10 17h8" />
        </Match>
        <Match when={props.kind === 'mail'}>
          <rect x="2" y="5" width="28" height="22" rx="4" />
          <path d="m3 7 13 11L29 7" />
        </Match>
      </Switch>
    </g>
  );
}

/** Floating product diagrams with a soft neutral glow and small accent details. */
export function BenefitVideoPoster(props: { tutorial: TutorialVideoId }) {
  const id = createUniqueId();
  const accent = () => wallpapers[props.tutorial].colors[1];
  return (
    <svg
      class="benefit-video-poster"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-glow`} cx=".5" cy=".47" r=".5">
          <stop stop-color="#fff" stop-opacity=".04" />
          <stop offset=".45" stop-color="#fff" stop-opacity=".018" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-focus`} x2="1" y2=".2">
          <stop stop-color="#ffffff12" />
          <stop offset="1" stop-color="#ffffff04" />
        </linearGradient>
        <linearGradient id={`${id}-fade`}>
          <stop stop-color="#000" />
          <stop offset=".07" stop-color="#fff" />
          <stop offset=".87" stop-color="#fff" />
          <stop offset="1" stop-color="#000" />
        </linearGradient>
        <linearGradient id={`${id}-vertical`} x2="0" y2="1">
          <stop stop-color="#000" />
          <stop offset=".15" stop-color="#fff" />
          <stop offset=".78" stop-color="#fff" />
          <stop offset="1" stop-color="#000" />
        </linearGradient>
        <mask id={`${id}-edges`}>
          <rect
            x="80"
            y="64"
            width="1440"
            height="680"
            fill={`url(#${id}-fade)`}
          />
        </mask>
        <mask id={`${id}-grid-fade`}>
          <rect
            x="80"
            y="64"
            width="1440"
            height="680"
            fill={`url(#${id}-vertical)`}
          />
        </mask>
        <clipPath id={`${id}-crop`}>
          <rect x="80" y="64" width="1440" height="680" rx="28" />
        </clipPath>
        <pattern
          id={`${id}-grid`}
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r=".7" fill="#fff" fill-opacity=".07" />
        </pattern>
      </defs>
      <ellipse cx="800" cy="420" rx="650" ry="350" fill={`url(#${id}-glow)`} />
      <g
        clip-path={`url(#${id}-crop)`}
        font-family="'Inter Variable', Inter, sans-serif"
        fill="#eeeeef"
        font-weight="450"
      >
        <g mask={`url(#${id}-grid-fade)`}>
          <path d="M80 64h1440v680H80z" fill={`url(#${id}-grid)`} />
        </g>
        <g mask={`url(#${id}-edges)`}>
          <Switch>
            <Match when={props.tutorial === 'company-graph'}>
              <g opacity=".4">
                <ItemIcon x={178} y={202} kind="doc" />
                <text x="232" y="230" font-size="32">
                  Product / Launch
                </text>
              </g>
              <text x="180" y="318" font-size="54" font-weight="500">
                Launch plan
              </text>
              <text x="180" y="392" font-size="30" fill="#8b8a93">
                Everything we need to get the beta out.
              </text>
              <rect
                x="176"
                y="438"
                width="660"
                height="80"
                rx="18"
                fill={`url(#${id}-focus)`}
              />
              <ItemIcon x={198} y={462} kind="task" color={accent()} />
              <text x="250" y="490" font-size="32" fill={accent()}>
                Invite beta customers
              </text>
              <path d="M250 500h341" stroke={accent()} stroke-opacity=".45" />
              <text x="180" y="574" font-size="28" fill="#66656f">
                Share the plan with the team.
              </text>
              <path d="M908 170v470" stroke="#ffffff14" />
              <text x="956" y="267" font-size="26" fill="#aaa9b2">
                References
              </text>
              <text x="1416" y="267" font-size="24" fill="#777680">
                3
              </text>
              <For
                each={[
                  {
                    kind: 'chat' as const,
                    title: '# product',
                    detail: 'Launch plan is ready for review',
                  },
                  {
                    kind: 'task' as const,
                    title: 'Invite beta customers',
                    detail: 'Linked from the launch plan',
                  },
                  {
                    kind: 'mail' as const,
                    title: 'Your early access invitation',
                    detail: 'The original customer thread',
                  },
                ]}
              >
                {(row, index) => (
                  <g
                    transform={`translate(956 ${304 + index() * 100})`}
                    opacity={index() === 1 ? 1 : 0.35}
                  >
                    <rect
                      x="-16"
                      width="640"
                      height="90"
                      rx="16"
                      fill={index() === 1 ? `url(#${id}-focus)` : 'none'}
                    />
                    <ItemIcon x={0} y={16} kind={row.kind} color={accent()} />
                    <text x="52" y="35" font-size="27">
                      {row.title}
                    </text>
                    <text x="52" y="69" font-size="20" fill="#a4a3ad">
                      {row.detail}
                    </text>
                  </g>
                )}
              </For>
              <Callout
                x={1140}
                y={304}
                label="Linked both ways"
                distance={92}
              />
              <Callout x={428} y={520} label="Live mention" below />
            </Match>
            <Match when={props.tutorial === 'ai-tagging'}>
              <g
                stroke="#fff"
                stroke-opacity=".14"
                stroke-dasharray="6 6"
                fill="none"
              >
                <path d="M80 360h1440M80 488h1440M332 64v680" />
              </g>
              <For
                each={[
                  {
                    title: 'Draft Q4 roadmap review',
                    tag: 'Planning',
                    color: '#ac99d8',
                  },
                  {
                    title: 'Fix checkout timeout',
                    tag: 'Bug',
                    color: '#f29c92',
                  },
                  {
                    title: 'Update onboarding checklist',
                    tag: 'Product',
                    color: '#8fbdaa',
                  },
                ]}
              >
                {(row, index) => (
                  <g
                    transform={`translate(112 ${232 + index() * 128})`}
                    opacity={index() === 1 ? 1 : 0.26}
                  >
                    <rect
                      width="1510"
                      height="128"
                      rx="30"
                      fill={index() === 1 ? `url(#${id}-focus)` : 'none'}
                    />
                    <g
                      transform="translate(70 43)"
                      fill={index() === 1 ? '#ff961f' : '#c0bec9'}
                    >
                      <rect width="40" height="42" rx="10" />
                      <path
                        d="M20 10v12M20 30v1"
                        stroke="#161618"
                        stroke-width="5"
                        stroke-linecap="round"
                      />
                    </g>
                    <circle
                      cx="165"
                      cy="64"
                      r="22"
                      fill="none"
                      stroke={row.color}
                      stroke-width="4"
                    />
                    <path d="M165 48a16 16 0 0 0 0 32z" fill={row.color} />
                    <text x="220" y="77" font-size="40" font-weight="500">
                      {row.title}
                    </text>
                    <rect
                      x="970"
                      y="36"
                      width="220"
                      height="56"
                      rx="28"
                      fill="#ffffff05"
                      stroke="#ffffff24"
                      stroke-width="2"
                    />
                    <circle cx="1000" cy="64" r="8" fill={row.color} />
                    <text x="1023" y="76" font-size="30">
                      {row.tag}
                    </text>
                  </g>
                )}
              </For>
              <Callout x={1200} y={396} label="Agent-applied tag" />
              <Callout x={277} y={485} label="Priority & status" below />
            </Match>
            <Match when={props.tutorial === 'automatic-permissions'}>
              <text x="214" y="240" font-size="44" font-weight="500">
                Shared in your channels.
              </text>
              <g stroke="#fff" stroke-opacity=".14" stroke-dasharray="6 6">
                <path d="M80 388h1440M80 496h1440" />
              </g>
              <For
                each={[
                  {
                    name: 'product',
                    members: '8 members',
                    letters: ['JL', 'SK', 'AM'],
                  },
                  {
                    name: 'engineering',
                    members: '12 members',
                    letters: ['TN', 'AC', 'RL'],
                  },
                  {
                    name: 'design',
                    members: '5 members',
                    letters: ['KD', 'LS', 'MJ'],
                  },
                ]}
              >
                {(row, index) => (
                  <g
                    transform={`translate(192 ${280 + index() * 108})`}
                    opacity={index() === 1 ? 1 : 0.28}
                  >
                    <rect
                      width="1260"
                      height="108"
                      rx="26"
                      fill={index() === 1 ? `url(#${id}-focus)` : 'none'}
                    />
                    <text x="30" y="71" font-size="46" fill={accent()}>
                      #
                    </text>
                    <text x="96" y="69" font-size="39" font-weight="500">
                      {row.name}
                    </text>
                    <For each={row.letters}>
                      {(letters, person) => (
                        <g transform={`translate(${626 + person() * 42} 28)`}>
                          <circle
                            cx="26"
                            cy="26"
                            r="26"
                            fill={['#474c5d', '#5d5159', '#4b5c53'][person()]}
                            stroke="#19191b"
                            stroke-width="3"
                          />
                          <text
                            x="26"
                            y="32"
                            text-anchor="middle"
                            font-size="15"
                          >
                            {letters}
                          </text>
                        </g>
                      )}
                    </For>
                    <text x="798" y="64" font-size="25" fill="#b5b4bf">
                      {row.members}
                    </text>
                    <path
                      d="m1046 53 8 8 17-19"
                      fill="none"
                      stroke={accent()}
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <text x="1091" y="65" font-size="27" fill={accent()}>
                      Can open
                    </text>
                  </g>
                )}
              </For>
              <Callout x={1285} y={424} label="Access follows the channel" />
              <Callout x={897} y={485} label="Everyone included" below />
            </Match>
            <Match when={props.tutorial === 'workspace-events'}>
              <text x="238" y="209" font-size="28" fill="#8e8d96">
                Activity
              </text>
              <path d="M273 276v350" stroke="#ffffff24" stroke-width="2" />
              <For
                each={[
                  {
                    kind: 'mail' as const,
                    title: 'Customer feedback received',
                    detail: 'New message in the launch thread',
                    time: '09:41',
                  },
                  {
                    kind: 'task' as const,
                    title: 'Task moved to In progress',
                    detail: 'Fix checkout timeout',
                    time: '09:42',
                  },
                  {
                    kind: 'chat' as const,
                    title: 'Engineering notified',
                    detail: 'Update shared with the channel',
                    time: '09:42',
                  },
                ]}
              >
                {(row, index) => (
                  <g
                    transform={`translate(232 ${244 + index() * 132})`}
                    opacity={index() === 1 ? 1 : 0.28}
                  >
                    <rect
                      x="-26"
                      y="-4"
                      width="1330"
                      height="128"
                      rx="28"
                      fill={index() === 1 ? `url(#${id}-focus)` : 'none'}
                    />
                    <circle
                      cx="41"
                      cy="47"
                      r="31"
                      fill="#202024"
                      stroke="#ffffff14"
                    />
                    <ItemIcon x={25} y={31} kind={row.kind} color={accent()} />
                    <text x="104" y="47" font-size="38" font-weight="500">
                      {row.title}
                    </text>
                    <text x="104" y="92" font-size="26" fill="#aaa9b3">
                      {row.detail}
                    </text>
                    <text
                      x="1124"
                      y="47"
                      font-size="25"
                      fill="#8d8b96"
                      font-family="monospace"
                    >
                      {row.time}
                    </text>
                  </g>
                )}
              </For>
              <Callout x={1043} y={396} label="Work becomes an event" />
              <Callout
                x={604}
                y={489}
                label="Original context attached"
                below
              />
            </Match>
            <Match when={props.tutorial === 'unified-search'}>
              <rect
                x="202"
                y="186"
                width="1320"
                height="92"
                rx="22"
                fill="#ffffff08"
                stroke="#ffffff25"
              />
              <circle
                cx="247"
                cy="228"
                r="15"
                fill="none"
                stroke="#cccbd3"
                stroke-width="3"
              />
              <path d="m258 240 12 12" stroke="#cccbd3" stroke-width="3" />
              <text x="298" y="246" font-size="38">
                launch plan
              </text>
              <path d="M513 212v40" stroke={accent()} stroke-width="2" />
              <g font-size="24" fill="#85838f">
                <rect
                  x="206"
                  y="301"
                  width="86"
                  height="43"
                  rx="21"
                  fill="#ffffff0d"
                />
                <text x="232" y="330" fill="#eee">
                  All
                </text>
                <text x="325" y="330">
                  Documents
                </text>
                <text x="508" y="330">
                  Messages
                </text>
                <text x="674" y="330">
                  Email
                </text>
                <text x="784" y="330">
                  Tasks
                </text>
              </g>
              <For
                each={[
                  {
                    kind: 'doc' as const,
                    title: 'Launch plan',
                    detail: 'Product / Projects / Beta launch',
                  },
                  {
                    kind: 'chat' as const,
                    title: 'The launch plan is ready for review',
                    detail: '# product · Message',
                  },
                  {
                    kind: 'mail' as const,
                    title: 'Re: Your early access invitation',
                    detail: 'Launch updates · Email thread',
                  },
                ]}
              >
                {(row, index) => (
                  <g
                    transform={`translate(204 ${370 + index() * 109})`}
                    opacity={index() === 0 ? 1 : 0.3}
                  >
                    <rect
                      width="1350"
                      height="105"
                      rx="24"
                      fill={index() === 0 ? `url(#${id}-focus)` : 'none'}
                    />
                    <ItemIcon x={32} y={27} kind={row.kind} color={accent()} />
                    <text x="92" y="48" font-size="35" font-weight="500">
                      {row.title}
                    </text>
                    <text x="92" y="84" font-size="23" fill="#a6a4af">
                      {row.detail}
                    </text>
                    <text x="1195" y="61" font-size="30" fill="#888691">
                      ↵
                    </text>
                  </g>
                )}
              </For>
              <Callout
                x={1300}
                y={274}
                label="One search. All your work."
                distance={92}
              />
            </Match>
          </Switch>
        </g>
      </g>
    </svg>
  );
}
