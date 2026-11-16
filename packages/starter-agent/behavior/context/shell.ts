/** Running other programs, injected. */
export type Ran = {
  /** 124 if it was killed at its time limit, like timeout(1). */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type RunOptions = {
  readonly cwd?: string;
  readonly stdin?: string;
  /** Added to this process's environment. An undefined value removes the variable. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
};

export type Started = {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly kill: () => void;
};

export type Shell = {
  /** Runs to the end and collects its output. */
  readonly run: (argv: readonly string[], options?: RunOptions) => Promise<Ran>;
  /** Starts it and returns at once. Its output goes to `log` if given, otherwise nowhere. */
  readonly start: (
    argv: readonly string[],
    options?: Omit<RunOptions, 'timeoutMs'> & {
      readonly log?: string;
      /** Keep running after this process ends. */
      readonly detached?: boolean;
    }
  ) => Started;
  /** Whether a process with this id is running. */
  readonly alive: (pid: number) => boolean;
};

export const timedOut = 124;

/** `run`, but throws on a non-zero exit, and returns stdout. */
export const output = async (
  shell: Pick<Shell, 'run'>,
  argv: readonly string[],
  options?: RunOptions
): Promise<string> => {
  const ran = await shell.run(argv, options);
  if (ran.code !== 0)
    throw new Error(
      `${argv[0]} exited ${ran.code}: ${ran.stderr.trim().slice(0, 500)}`
    );
  return ran.stdout;
};
