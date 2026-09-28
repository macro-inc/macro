import { match } from 'ts-pattern';

/** Wire, database and route spelling of every game. Matches the backend enum. */
export const GAME_KINDS = [
  'pong',
  'brick_breaker',
  'snake',
  'falling_blocks',
  'invaders',
  'flappy',
  'twenty_forty_eight',
  'minesweeper',
  'tic_tac_toe',
  'connect_four',
  'dots_and_boxes',
  'typing_race',
] as const;

export type GameKind = (typeof GAME_KINDS)[number];

/** Solo rooms record runs, versus rooms seat two, party rooms seat up to eight. */
export type GameCategory = 'solo' | 'versus' | 'party';

export type ScoreUnit = 'points' | 'wpm' | 'milliseconds';

/**
 * High-score games rank each player's best result; win games rank how many
 * rounds a player has won outright.
 */
export type GameScoring =
  | { t: 'high-score'; order: 'desc' | 'asc'; unit: ScoreUnit }
  | { t: 'wins' };

export type GameDefinition = {
  kind: GameKind;
  title: string;
  tagline: string;
  howToPlay: string;
  category: GameCategory;
  players: { min: number; max: number };
  scoring: GameScoring;
};

export const GAME_CATALOG: Record<GameKind, GameDefinition> = {
  pong: {
    kind: 'pong',
    title: 'Pong',
    tagline: 'Two paddles, one ball. First to 7 wins.',
    howToPlay:
      'Move your paddle with the mouse, touch, or the up and down arrow keys (W and S work too). Get the ball past your opponent to score; first to 7 wins. On your own? Practice against the computer.',
    category: 'versus',
    players: { min: 2, max: 2 },
    scoring: { t: 'wins' },
  },
  brick_breaker: {
    kind: 'brick_breaker',
    title: 'Brick Breaker',
    tagline: 'Bounce the ball and smash every brick.',
    howToPlay:
      'Move the paddle with the mouse, touch, or the arrow keys, and click or press Space to launch. Clear every brick to reach the next level. You have three balls.',
    category: 'solo',
    players: { min: 1, max: 1 },
    scoring: { t: 'high-score', order: 'desc', unit: 'points' },
  },
  falling_blocks: {
    kind: 'falling_blocks',
    title: 'Falling Blocks',
    tagline: 'Rotate the falling pieces and clear full lines.',
    howToPlay:
      'Left and right move, Up rotates, Down drops faster, and Space drops instantly. Clearing several lines at once scores more, and the pace picks up every ten lines. On touch screens, tap to rotate and swipe to move or drop.',
    category: 'solo',
    players: { min: 1, max: 1 },
    scoring: { t: 'high-score', order: 'desc', unit: 'points' },
  },
  invaders: {
    kind: 'invaders',
    title: 'Invaders',
    tagline: 'Hold the line against waves of descending aliens.',
    howToPlay:
      'Move with the arrow keys, mouse, or touch, and fire with Space or a click. Clear a wave to face a faster one. You have three lives, and the game ends if the aliens land.',
    category: 'solo',
    players: { min: 1, max: 1 },
    scoring: { t: 'high-score', order: 'desc', unit: 'points' },
  },
  flappy: {
    kind: 'flappy',
    title: 'Flappy',
    tagline: 'Flap through the gaps between the pipes.',
    howToPlay:
      'Click, tap, or press Space to flap. Fly through the gaps; every pipe you pass is a point.',
    category: 'solo',
    players: { min: 1, max: 1 },
    scoring: { t: 'high-score', order: 'desc', unit: 'points' },
  },
  snake: {
    kind: 'snake',
    title: 'Snake',
    tagline: 'Eat, grow, and do not bite your own tail.',
    howToPlay:
      'Steer with the arrow keys or WASD, or swipe on touch screens. Each apple is worth 10 points and speeds you up.',
    category: 'solo',
    players: { min: 1, max: 1 },
    scoring: { t: 'high-score', order: 'desc', unit: 'points' },
  },
  twenty_forty_eight: {
    kind: 'twenty_forty_eight',
    title: '2048',
    tagline: 'Slide and merge tiles until you reach 2048.',
    howToPlay:
      'Use the arrow keys or WASD, or swipe, to slide every tile. Matching tiles merge and add their value to your score.',
    category: 'solo',
    players: { min: 1, max: 1 },
    scoring: { t: 'high-score', order: 'desc', unit: 'points' },
  },
  minesweeper: {
    kind: 'minesweeper',
    title: 'Minesweeper',
    tagline: 'Clear the field without touching a mine.',
    howToPlay:
      'Click to reveal a cell; numbers count neighboring mines. Right-click, long-press, or use flag mode to mark a mine. Click a satisfied number to clear around it. Fastest clear wins.',
    category: 'solo',
    players: { min: 1, max: 1 },
    scoring: { t: 'high-score', order: 'asc', unit: 'milliseconds' },
  },
  tic_tac_toe: {
    kind: 'tic_tac_toe',
    title: 'Tic-Tac-Toe',
    tagline: 'Three in a row, best of however many you like.',
    howToPlay:
      'Take turns placing your mark. Three in a row wins. The first move alternates every rematch.',
    category: 'versus',
    players: { min: 2, max: 2 },
    scoring: { t: 'wins' },
  },
  connect_four: {
    kind: 'connect_four',
    title: 'Connect Four',
    tagline: 'Drop discs and line up four before your opponent.',
    howToPlay:
      'Take turns dropping a disc into a column. Four in a row horizontally, vertically, or diagonally wins.',
    category: 'versus',
    players: { min: 2, max: 2 },
    scoring: { t: 'wins' },
  },
  dots_and_boxes: {
    kind: 'dots_and_boxes',
    title: 'Dots and Boxes',
    tagline: 'Close boxes to claim them and take another turn.',
    howToPlay:
      'Take turns drawing a line between two dots. Completing a box claims it and earns another turn. Most boxes wins. Two to four players.',
    category: 'party',
    players: { min: 2, max: 4 },
    scoring: { t: 'wins' },
  },
  typing_race: {
    kind: 'typing_race',
    title: 'Typing Race',
    tagline: 'Race your teammates through the same passage.',
    howToPlay:
      'Join the race, wait for the countdown, then type the passage exactly. Fix mistakes before moving on. Best words per minute wins.',
    category: 'party',
    players: { min: 1, max: 8 },
    scoring: { t: 'high-score', order: 'desc', unit: 'wpm' },
  },
};

export function isGameKind(value: unknown): value is GameKind {
  return (
    typeof value === 'string' &&
    (GAME_KINDS as readonly string[]).includes(value)
  );
}

export function gameDefinition(kind: GameKind): GameDefinition {
  return GAME_CATALOG[kind];
}

const numberFormat = new Intl.NumberFormat('en-US');

/** Render a score in the unit its game ranks by. */
export function formatScore(unit: ScoreUnit, value: number): string {
  return match(unit)
    .with('points', () => numberFormat.format(value))
    .with('wpm', () => `${numberFormat.format(value)} WPM`)
    .with('milliseconds', () => `${(value / 1000).toFixed(1)}s`)
    .exhaustive();
}

/** Whether `candidate` beats `current` under a game's ranking order. */
export function isBetterScore(
  order: 'desc' | 'asc',
  candidate: number,
  current: number | undefined
): boolean {
  if (current === undefined) return true;
  return order === 'desc' ? candidate > current : candidate < current;
}
