/**
 * The commands a bash string really runs, for guards: text inside a quoted
 * argument isn't a command, while `$(...)`, backticks, `bash -c`, `eval`, and
 * a heredoc fed to a shell are. It reads what people type; it isn't a full
 * bash grammar, and a guard built on it stops reflexes, not someone
 * determined to get past it.
 *
 * The scanner keeps its place in local variables, as a parser does; nothing
 * outside a call to `commands` sees them, so it is pure from outside.
 */
import { basename } from './path.ts';

export type Command = {
  readonly argv: readonly string[];
  /** VAR=value prefixes, and env's. */
  readonly env: Readonly<Record<string, string>>;
  readonly redirects: readonly string[];
  /** Where an earlier `cd` in this string left it, unexpanded. */
  readonly cwd?: string;
  /** The command on the left of a `|`. */
  readonly pipedFrom?: Command;
};

const keywords: ReadonlySet<string> = new Set([
  'if',
  'then',
  'elif',
  'else',
  'do',
  'while',
  'until',
  '!',
  '{',
  '}',
  'time',
  'fi',
  'done',
  'esac',
]);
const shells: ReadonlySet<string> = new Set(['bash', 'sh', 'zsh', 'dash']);
/** Wrappers that run the command after their own options. */
const wrappers: ReadonlySet<string> = new Set([
  'command',
  'builtin',
  'exec',
  'nohup',
  'setsid',
  'nice',
  'sudo',
  'xargs',
  'stdbuf',
]);
const assignment = /^([A-Za-z_]\w*)=([\s\S]*)$/;

type Environment = Readonly<Record<string, string>>;
type State = { readonly out: Command[]; cwd?: string };
type Heredoc = {
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly strip: boolean;
};

/** The program a command runs, without the folder it was found in. */
export const program = (command: Command): string =>
  basename(command.argv[0] ?? '');

/** Drops wrappers that run another command, so `env X=1 timeout 5 git pull` reads as git. */
const unwrap = (
  words: readonly string[],
  assigned: Environment
): { readonly argv: readonly string[]; readonly env: Environment } => {
  let argv = words;
  let env = assigned;
  for (;;) {
    const name = basename(argv[0] ?? '');
    if (name === 'env') {
      argv = argv.slice(1);
      for (;;) {
        const first = argv[0];
        if (first === undefined || first === '') break;
        const match = assignment.exec(first);
        if (match) {
          env = { ...env, [match[1] ?? '']: match[2] ?? '' };
          argv = argv.slice(1);
        } else if (first === '-u' || first === '-C') argv = argv.slice(2);
        else if (first.startsWith('-')) argv = argv.slice(1);
        else break;
      }
    } else if (wrappers.has(name)) {
      argv = argv.slice(1);
      for (;;) {
        const first = argv[0];
        if (first === undefined || !first.startsWith('-')) break;
        argv = argv.slice(/^-[nuIPLgs]$/.test(first) ? 2 : 1);
      }
    } else if (name === 'timeout') {
      argv = argv.slice(1);
      for (;;) {
        const first = argv[0];
        if (first === undefined || !first.startsWith('-')) break;
        argv = argv.slice(first === '-k' || first === '-s' ? 2 : 1);
      }
      argv = argv.slice(1);
    } else if (name === 'nix' && argv[1] === 'develop') {
      const at = argv.findIndex(
        (word) => word === '-c' || word === '--command'
      );
      if (at < 0) return { argv, env };
      argv = argv.slice(at + 1);
    } else if (name === 'doppler' && argv[1] === 'run') {
      // Reading through `doppler run` only makes a guard stricter.
      const at = argv.indexOf('--');
      if (at < 0) return { argv, env };
      argv = argv.slice(at + 1);
    } else return { argv, env };
  }
};

const finish = (
  words: readonly string[],
  redirects: readonly string[],
  pipedFrom: Command | undefined,
  state: State
): Command | undefined => {
  let rest = words;
  let assigned: Environment = {};
  for (;;) {
    const first = rest[0];
    if (first === undefined || !keywords.has(first)) break;
    rest = rest.slice(1);
  }
  for (;;) {
    const match = assignment.exec(rest[0] ?? '');
    if (!match) break;
    assigned = { ...assigned, [match[1] ?? '']: match[2] ?? '' };
    rest = rest.slice(1);
  }
  const { argv, env } = unwrap(rest, assigned);
  if (argv.length === 0 && Object.keys(env).length === 0) return undefined;
  const command: Command = {
    argv,
    env,
    redirects,
    ...(state.cwd ? { cwd: state.cwd } : {}),
    ...(pipedFrom ? { pipedFrom } : {}),
  };
  state.out.push(command);
  const name = program(command);
  const to = argv[1];
  if ((name === 'cd' || name === 'pushd') && to && to !== '-')
    state.cwd = /^[/~$]/.test(to) || !state.cwd ? to : `${state.cwd}/${to}`;
  if (shells.has(name)) {
    const at = argv.findIndex(
      (word, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(word)
    );
    const script = at > 0 ? argv[at + 1] : undefined;
    // A copy, so a `cd` inside the inner shell doesn't move the outer one.
    if (script) scan(script, { out: state.out, cwd: state.cwd });
  }
  if (name === 'eval') scan(argv.slice(1).join(' '), state);
  return command;
};

/** The index just past the `)` closing a `$(` that opened before `from`. */
const closeParen = (source: string, from: number): number => {
  let index = from;
  let depth = 1;
  while (index < source.length && depth > 0) {
    const character = source.charAt(index);
    if (character === '\\') index += 2;
    else if (character === "'") {
      const end = source.indexOf("'", index + 1);
      if (end < 0) return source.length;
      index = end + 1;
    } else if (character === '"') {
      index += 1;
      while (index < source.length && source.charAt(index) !== '"') {
        if (source.charAt(index) === '\\') index += 2;
        else if (source.startsWith('$(', index))
          index = closeParen(source, index + 2);
        else index += 1;
      }
      index += 1;
    } else {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      index += 1;
    }
  }
  return index;
};

/** Runs what's inside any `$(...)` or backticks in text a shell will expand (a heredoc's body). */
const substitutions = (source: string, state: State): void => {
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith('$(', index)) {
      const end = closeParen(source, index + 2);
      scan(source.slice(index + 2, end - 1), state);
      index = end - 1;
    } else if (source.charAt(index) === '`') {
      const end = source.indexOf('`', index + 1);
      if (end < 0) return;
      scan(source.slice(index + 1, end), state);
      index = end;
    }
  }
};

/** One command being read: the words so far, and the word in progress. */
type Line = {
  words: string[];
  word: string | undefined;
  redirects: string[];
  toRedirect: boolean;
  pipedFrom: Command | undefined;
};

function scan(source: string, state: State): void {
  let index = 0;
  const line: Line = {
    words: [],
    word: undefined,
    redirects: [],
    toRedirect: false,
    pipedFrom: undefined,
  };
  let heredocs: Heredoc[] = [];
  let lineStart = state.out.length;

  const endWord = (): void => {
    if (line.word === undefined) return;
    if (line.toRedirect) {
      line.redirects.push(line.word);
      line.toRedirect = false;
    } else line.words.push(line.word);
    line.word = undefined;
  };
  const endCommand = (): Command | undefined => {
    endWord();
    const command = finish(line.words, line.redirects, line.pipedFrom, state);
    line.words = [];
    line.redirects = [];
    line.pipedFrom = undefined;
    return command;
  };
  const add = (text: string): void => {
    line.word = (line.word ?? '') + text;
  };
  /** At a `$(`. */
  const substitution = (): void => {
    const end = closeParen(source, index + 2);
    scan(source.slice(index + 2, end - 1), state);
    add(source.slice(index, end));
    index = end;
  };
  /** At a backtick: runs what is inside, and returns the index past its end. */
  const backticks = (): number => {
    const end = source.indexOf('`', index + 1);
    const stop = end < 0 ? source.length : end;
    scan(source.slice(index + 1, stop), state);
    return stop + 1;
  };

  while (index < source.length) {
    const character = source.charAt(index);
    if (character === '\\') {
      if (source.charAt(index + 1) !== '\n') add(source.charAt(index + 1));
      index += 2;
    } else if (character === "'") {
      const end = source.indexOf("'", index + 1);
      add(source.slice(index + 1, end < 0 ? source.length : end));
      index = end < 0 ? source.length : end + 1;
    } else if (character === '"') {
      add('');
      index += 1;
      while (index < source.length && source.charAt(index) !== '"') {
        if (source.charAt(index) === '\\') {
          add(source.charAt(index + 1));
          index += 2;
        } else if (source.startsWith('$(', index)) substitution();
        else if (source.charAt(index) === '`') index = backticks();
        else {
          add(source.charAt(index));
          index += 1;
        }
      }
      index += 1;
    } else if (source.startsWith('$(', index)) {
      substitution();
    } else if (character === '`') {
      index = backticks();
      add('$()');
    } else if (character === '#' && line.word === undefined) {
      while (index < source.length && source.charAt(index) !== '\n') index += 1;
    } else if (character === '\n') {
      endCommand();
      index += 1;
      for (const heredoc of heredocs) {
        const start = index;
        let end = source.length;
        while (index < source.length) {
          const newline = source.indexOf('\n', index);
          const stop = newline < 0 ? source.length : newline;
          const text = source.slice(index, stop);
          if (
            (heredoc.strip ? text.replace(/^\t+/, '') : text) ===
            heredoc.delimiter
          ) {
            end = index;
            index = stop + 1;
            break;
          }
          index = stop + 1;
          end = index;
        }
        const body = source.slice(start, end);
        if (
          state.out
            .slice(lineStart)
            .some((command) => shells.has(program(command)))
        )
          scan(body, state);
        else if (!heredoc.quoted) substitutions(body, state);
      }
      heredocs = [];
      lineStart = state.out.length;
    } else if (character === ';' || character === '(' || character === ')') {
      endCommand();
      index += 1;
    } else if (character === '&') {
      if (source.charAt(index + 1) === '>') {
        endWord();
        line.toRedirect = true;
        index += source.charAt(index + 2) === '>' ? 3 : 2;
      } else {
        endCommand();
        index += source.charAt(index + 1) === '&' ? 2 : 1;
      }
    } else if (character === '|') {
      const isOr = source.charAt(index + 1) === '|';
      const command = endCommand();
      if (!isOr) line.pipedFrom = command;
      index += isOr || source.charAt(index + 1) === '&' ? 2 : 1;
    } else if (
      source.startsWith('<<', index) &&
      source.charAt(index + 2) !== '<'
    ) {
      endWord();
      index += 2;
      const strip = source.charAt(index) === '-';
      if (strip) index += 1;
      while (source.charAt(index) === ' ' || source.charAt(index) === '\t')
        index += 1;
      const match = /^(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/.exec(
        source.slice(index)
      );
      if (match) {
        heredocs.push({
          delimiter: match[1] ?? match[2] ?? match[3] ?? '',
          quoted: match[1] !== undefined || match[2] !== undefined,
          strip,
        });
        index += match[0].length;
      }
    } else if (character === '>' || character === '<') {
      // `2>file`: the digits are the descriptor, not a word.
      if (line.word !== undefined && /^\d+$/.test(line.word))
        line.word = undefined;
      endWord();
      index +=
        source.startsWith('>>', index) ||
        source.startsWith('<<<', index) ||
        source.startsWith('>&', index) ||
        source.startsWith('<&', index)
          ? 2
          : 1;
      if (source.charAt(index) === '<') index += 1;
      line.toRedirect = true;
    } else if (character === ' ' || character === '\t') {
      endWord();
      index += 1;
    } else {
      add(character);
      index += 1;
    }
  }
  endCommand();
}

/** Every simple command this string runs, in order. */
export const commands = (source: string): readonly Command[] => {
  const state: State = { out: [] };
  scan(source, state);
  return state.out;
};

/** `~`, `$HOME`, and other variables the session's environment knows. */
export const expand = (
  word: string,
  environment: Readonly<Record<string, string | undefined>>
): string =>
  word
    .replace(/^~(?=\/|$)/, environment.HOME ?? '~')
    .replace(
      /\$\{?([A-Za-z_]\w*)\}?/g,
      (all, name: string) => environment[name] ?? all
    );
