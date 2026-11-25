/**
 * The solver's settings: where its runs keep their files, where the harness
 * says which computer this is (for the owner's screen link), and its limits.
 * Nothing else in the area names a path.
 */
import type { Config } from '../../context/config.ts';
import type { State } from '../../context/state.ts';

/** The owner of the solver's state directories. */
export const owner = 'captcha';

/** The harness's file naming this computer's harness, under the agent's home (agent-screen core). */
const harnessIdPath = ['state', 'harness-id'] as const;

export type CaptchaConfig = {
  /** Each solve's own directory goes under here, and is removed after. */
  readonly runs: string;
  readonly harnessIdFile: string;
  /** The MCP server's entry, which OpenCode starts. */
  readonly server: string;
  /** Most time one OpenCode run gets, its two solves included. */
  readonly runLimitMs: number;
};

export const captchaConfig = ({
  state,
  config,
  join,
}: {
  readonly state: Pick<State, 'run'>;
  readonly config: Pick<Config, 'home'>;
  readonly join: (...parts: readonly string[]) => string;
}): CaptchaConfig => ({
  runs: state.run(owner),
  harnessIdFile: join(config.home, ...harnessIdPath),
  server: join(import.meta.dir, 'mcp.ts'),
  runLimitMs: 300_000,
});
