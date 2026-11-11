import { createUniqueId } from 'solid-js';
import type { TutorialVideoId } from '../core/tutorial-videos';

export const wallpapers: Record<
  TutorialVideoId,
  { colors: [string, string, string, string]; ridge: number; crest: number }
> = {
  home: {
    colors: ['#d5e8ef', '#91b7ce', '#657fbc', '#424a86'],
    ridge: 720,
    crest: 360,
  },
  mail: {
    colors: ['#ead0ed', '#cc65a2', '#971db7', '#450586'],
    ridge: 690,
    crest: 400,
  },
  tasks: {
    colors: ['#c4eee3', '#49ac9c', '#237b80', '#16425e'],
    ridge: 560,
    crest: 310,
  },
  chat: {
    colors: ['#e2dbff', '#9c86dd', '#6254b2', '#30256d'],
    ridge: 800,
    crest: 470,
  },
  docs: {
    colors: ['#d2eaff', '#74b6d8', '#357fae', '#1b477c'],
    ridge: 650,
    crest: 260,
  },
  calls: {
    colors: ['#ffd8cc', '#e88b88', '#b95175', '#672650'],
    ridge: 900,
    crest: 370,
  },
  crm: {
    colors: ['#ffdfb6', '#e9a466', '#bc6344', '#723c40'],
    ridge: 740,
    crest: 520,
  },
  agents: {
    colors: ['#dadbff', '#8496e7', '#5362ba', '#2c3477'],
    ridge: 510,
    crest: 420,
  },
  github: {
    colors: ['#d4e5ee', '#8caabd', '#506c88', '#2d3b5d'],
    ridge: 850,
    crest: 290,
  },
  forms: {
    colors: ['#ffe1dc', '#e99588', '#b76681', '#673952'],
    ridge: 640,
    crest: 420,
  },
  calendar: {
    colors: ['#e8eccb', '#a1bb79', '#678e67', '#345957'],
    ridge: 600,
    crest: 480,
  },
  scheduling: {
    colors: ['#ffe5c8', '#dfb476', '#b18362', '#6c5360'],
    ridge: 950,
    crest: 440,
  },
  drive: {
    colors: ['#c9edf4', '#6cb8c6', '#357f98', '#234864'],
    ridge: 770,
    crest: 330,
  },
  spreadsheets: {
    colors: ['#e3f1c9', '#aac879', '#5b987b', '#2d5e60'],
    ridge: 680,
    crest: 390,
  },
  databases: {
    colors: ['#c9eaf4', '#78bfd0', '#397fab', '#29466f'],
    ridge: 830,
    crest: 350,
  },
  canvas: {
    colors: ['#ffe1cd', '#eaa387', '#c66672', '#783d62'],
    ridge: 570,
    crest: 460,
  },
  macrod: {
    colors: ['#d5e6f5', '#8badd5', '#686cb0', '#3b396b'],
    ridge: 920,
    crest: 300,
  },
  routines: {
    colors: ['#f5e4bc', '#d2b477', '#9a814f', '#5d553b'],
    ridge: 610,
    crest: 450,
  },
  skills: {
    colors: ['#e5d8fa', '#bda0e2', '#8465b5', '#4c3673'],
    ridge: 860,
    crest: 320,
  },
  'company-graph': {
    colors: ['#dce6ff', '#8caaf4', '#596cc4', '#343c79'],
    ridge: 720,
    crest: 360,
  },
  'ai-tagging': {
    colors: ['#edddff', '#bba0e8', '#9061bd', '#563377'],
    ridge: 720,
    crest: 360,
  },
  'automatic-permissions': {
    colors: ['#d4f2e9', '#79c6ba', '#479787', '#255b64'],
    ridge: 720,
    crest: 360,
  },
  'workspace-events': {
    colors: ['#f5e6cf', '#d6b78c', '#ad7e60', '#70454b'],
    ridge: 720,
    crest: 360,
  },
  'unified-search': {
    colors: ['#dbedf7', '#90bcd8', '#5d8fb3', '#355775'],
    ridge: 720,
    crest: 360,
  },
};

/** Original layered landscape, with a distinct palette and silhouette per feature. */
export function TutorialWallpaper(props: { tutorial: TutorialVideoId }) {
  const id = createUniqueId();
  const theme = () => wallpapers[props.tutorial];
  return (
    <svg
      class="tutorial-wallpaper"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x2="1" y2="1">
          <stop stop-color={theme().colors[0]} />
          <stop offset="1" stop-color={theme().colors[1]} />
        </linearGradient>
        <linearGradient id={`${id}-ridge`} x2=".7" y2="1">
          <stop stop-color={theme().colors[1]} />
          <stop offset="1" stop-color={theme().colors[2]} />
        </linearGradient>
        <linearGradient id={`${id}-front`} x2="1" y2=".6">
          <stop stop-color={theme().colors[2]} />
          <stop offset="1" stop-color={theme().colors[3]} />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}-sky)`} d="M0 0h1920v1080H0z" />
      <path
        fill={`url(#${id}-ridge)`}
        d={`M0 0H${theme().ridge}C${theme().ridge + 240} 100 ${theme().ridge - 70} 380 1120 540S1650 360 1920 120V1080H0Z`}
      />
      <path
        fill={theme().colors[2]}
        opacity=".28"
        d={`M0 0H${theme().ridge * 0.55}C${theme().ridge * 0.65} 110 220 120 470 310S890 530 1100 780H0Z`}
      />
      <path
        fill={theme().colors[0]}
        opacity=".16"
        d={`M${theme().ridge + 420} 0H${theme().ridge + 650}C1480 280 1240 330 1250 630S1720 800 1920 900V1080C1370 880 970 670 1120 370Z`}
      />
      <path
        fill={`url(#${id}-front)`}
        d={`M0 ${theme().crest}C370 ${theme().crest - 180} 510 730 950 790S1550 630 1920 440V1080H0Z`}
      />
      <path
        fill={theme().colors[3]}
        opacity=".5"
        d={`M0 ${theme().crest + 180}C360 470 510 950 1100 930S1700 760 1920 800V1080H0Z`}
      />
    </svg>
  );
}
