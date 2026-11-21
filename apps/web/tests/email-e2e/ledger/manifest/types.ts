// The shape of the coverage manifest: every email surface in the web app,
// what a user can do on it and what it can show, as the variants of the
// functions in `../functions.tsv`. `../README.md` says how a
// row is counted.

export type Provider = 'gmail' | 'outlook';
export type Viewport = 'desktop' | 'phone';

export const BOTH_PROVIDERS: readonly Provider[] = ['gmail', 'outlook'];
export const BOTH_VIEWPORTS: readonly Viewport[] = ['desktop', 'phone'];

type Applies = {
  /**
   * The functions (`../functions.tsv`) it belongs to: an action is a way to do
   * them, a state is how their result shows.
   */
  fn?: readonly string[];
  /** The providers it exists for; both when left out. */
  providers?: readonly Provider[];
  /** The layouts it exists in; the surface's when left out. */
  viewports?: readonly Viewport[];
  /** The feature flags it needs. */
  flag?: string;
  /**
   * What the per-test stack lacks to drive it (a service, a clock): its
   * tests run on the full-stack tier.
   */
  needs?: string;
  note?: string;
};

export type Surface = {
  id: string;
  name: string;
  /** The route, or how a user gets to it. */
  opened: string;
  viewports: readonly Viewport[];
  /** As `needs` of a row, for every row of the surface. */
  needs?: string;
};

export type Action = Applies & {
  id: string;
  surface: string;
  action: string;
  /** What the user does: the control, the key. */
  trigger: string;
  /** The files that handle it, from `apps/web`. */
  source: readonly string[];
  /**
   * What the code registers for it, as `../derive.ts` names them: a hotkey
   * token (`email.reply`) or, for a hotkey without one, `<file>#<description>`.
   */
  registered?: readonly string[];
};

export type State = Applies & {
  id: string;
  surface: string;
  /** What is on the screen: the text, the control, the mark. */
  state: string;
  /** What brings it up. */
  trigger: string;
  source: readonly string[];
  /** The toasts it stands for, as `../derive.ts` names them: `<file>#<text>`. */
  toasts?: readonly string[];
};

/** One file of the manifest: a group of surfaces with their rows. */
export type Group = {
  name: string;
  surfaces: readonly Surface[];
  actions: readonly Action[];
  states: readonly State[];
};

/** A request the web app's email code can make. */
export type Operation = {
  /** `GET /email/threads/{}`, with the service's prefix, or a GraphQL operation's name. */
  id: string;
  kind: 'rest' | 'query' | 'mutation' | 'subscription';
  /**
   * `email`: email's own, held to the source (`emailOwned` in
   * `../derive.ts`). `shared`: of another part of the app and made by an
   * email page too; kept by hand. What no email page makes is not listed.
   */
  scope: 'email' | 'shared';
  /**
   * The providers the app makes it for; left out, both. (`providers` on a
   * row of the report is where it was seen.)
   */
  appliesTo?: readonly Provider[];
  needs?: string;
  note?: string;
};
