// The parser is otherwise tested only through the guards built on it. These pin the
// parser's own behavior, case by case, so a guard's failure can be told from a
// parser's.
import { expect, test } from 'bun:test';
import { commands, expand, program } from '../shell.ts';

const argvs = (source: string) => commands(source).map(({ argv }) => argv);

test('words, quotes and escapes', () => {
  expect(argvs('git status')).toEqual([['git', 'status']]);
  expect(argvs('git commit -m \'a b\' "c d" e\\ f')).toEqual([
    ['git', 'commit', '-m', 'a b', 'c d', 'e f'],
  ]);
  expect(argvs('echo "a \\"b\\" c" \'\'')).toEqual([['echo', 'a "b" c', '']]);
  expect(argvs('echo a\\\nb')).toEqual([['echo', 'ab']]);
  expect(argvs('')).toEqual([]);
});

test('every way of joining commands', () => {
  expect(argvs('a; b && c || d & e\nf')).toEqual([
    ['a'],
    ['b'],
    ['c'],
    ['d'],
    ['e'],
    ['f'],
  ]);
  expect(argvs('(a; b)')).toEqual([['a'], ['b']]);
  expect(argvs('if a; then b; else c; fi')).toEqual([['a'], ['b'], ['c']]);
  expect(argvs('while a; do b; done')).toEqual([['a'], ['b']]);
  expect(argvs('! a')).toEqual([['a']]);
});

test('a pipe remembers its left side; || does not', () => {
  const [left, right] = commands('gh pr diff 12 | git apply');
  expect(left?.argv).toEqual(['gh', 'pr', 'diff', '12']);
  expect(right?.argv).toEqual(['git', 'apply']);
  expect(right?.pipedFrom).toBe(left);
  expect(commands('a || b')[1]?.pipedFrom).toBeUndefined();
  expect(commands('a |& b')[1]?.pipedFrom?.argv).toEqual(['a']);
});

test('text in a quoted argument is not a command; a substitution is', () => {
  expect(argvs('echo "git pull"')).toEqual([['echo', 'git pull']]);
  expect(argvs("echo 'x $(git pull)'")).toEqual([['echo', 'x $(git pull)']]);
  expect(argvs('echo "$(git pull)"')).toEqual([
    ['git', 'pull'],
    ['echo', '$(git pull)'],
  ]);
  expect(argvs('x=$(git pull)')).toEqual([['git', 'pull'], []]);
  expect(argvs('x=`git fetch`')).toEqual([['git', 'fetch'], []]);
  expect(argvs('echo "a `git fetch` b"')).toEqual([
    ['git', 'fetch'],
    ['echo', 'a  b'],
  ]);
  expect(argvs('echo "$(echo "$(git pull)")"')).toEqual([
    ['git', 'pull'],
    ['echo', '$(git pull)'],
    ['echo', '$(echo "$(git pull)")'],
  ]);
  expect(argvs('echo "$(echo \')\')" ; ls')).toEqual([
    ['echo', ')'],
    ['echo', "$(echo ')')"],
    ['ls'],
  ]);
});

test('a shell given a string, and eval, run it', () => {
  expect(argvs('bash -c "git pull"')).toEqual([
    ['bash', '-c', 'git pull'],
    ['git', 'pull'],
  ]);
  expect(argvs("sh -lc 'a && b'")).toEqual([
    ['sh', '-lc', 'a && b'],
    ['a'],
    ['b'],
  ]);
  expect(argvs('eval "git pull"')).toEqual([
    ['eval', 'git pull'],
    ['git', 'pull'],
  ]);
  expect(argvs('bash script.sh')).toEqual([['bash', 'script.sh']]);
});

test("heredocs: a shell's is commands, a quoted one is text, an open one expands", () => {
  expect(argvs('bash <<EOF\ngit pull\nEOF')).toEqual([
    ['bash'],
    ['git', 'pull'],
  ]);
  expect(argvs('cat <<EOF\n$(git pull)\nplain git fetch\nEOF\nls')).toEqual([
    ['cat'],
    ['git', 'pull'],
    ['ls'],
  ]);
  expect(argvs("cat <<'EOF'\ngit pull\n$(git fetch)\nEOF")).toEqual([['cat']]);
  expect(argvs('cat <<"EOF"\n$(git fetch)\nEOF')).toEqual([['cat']]);
  expect(argvs('cat <<-EOF\n\t`git fetch`\n\tEOF\nls')).toEqual([
    ['cat'],
    ['git', 'fetch'],
    ['ls'],
  ]);
  expect(argvs("cat <<< 'git pull'")).toEqual([['cat']]);
});

test('comments are not commands', () => {
  expect(argvs('# git pull\nls')).toEqual([['ls']]);
  expect(argvs('ls # git pull')).toEqual([['ls']]);
  expect(argvs('echo a#b')).toEqual([['echo', 'a#b']]);
});

test('assignments and wrappers are read through to the command they run', () => {
  const [prefixed] = commands("FOO=1 BAR='a b' git pull");
  expect(prefixed?.argv).toEqual(['git', 'pull']);
  expect(prefixed?.env).toEqual({ FOO: '1', BAR: 'a b' });
  const [viaEnv] = commands('env -u X A=1 GH_TOKEN=t gh pr list');
  expect(viaEnv?.argv).toEqual(['gh', 'pr', 'list']);
  expect(viaEnv?.env).toEqual({ A: '1', GH_TOKEN: 't' });
  expect(commands('X=1')[0]).toEqual({
    argv: [],
    env: { X: '1' },
    redirects: [],
  });
  for (const [source, argv] of [
    ['timeout 30 git pull', ['git', 'pull']],
    ['timeout -k 5 30 git pull', ['git', 'pull']],
    ['sudo -u owner git pull', ['git', 'pull']],
    ['nohup nice git pull', ['git', 'pull']],
    ['command git pull', ['git', 'pull']],
    ['exec git pull', ['git', 'pull']],
    ['xargs -n 1 git fetch', ['git', 'fetch']],
    ['doppler run -- git pull', ['git', 'pull']],
    ['doppler run -p x -c y -- env A=1 git pull', ['git', 'pull']],
    ['nix develop /home/owner/agent --command git pull', ['git', 'pull']],
    ['nix develop -c bun test', ['bun', 'test']],
    ['nix develop', ['nix', 'develop']],
    ['doppler run', ['doppler', 'run']],
  ] as const)
    expect([source, argvs(source)]).toEqual([source, [[...argv]]]);
  expect(argvs("nix develop . --command bash -c 'git pull'")).toEqual([
    ['bash', '-c', 'git pull'],
    ['git', 'pull'],
  ]);
});

test('redirects are kept apart from the arguments', () => {
  expect(commands('echo x > .git/config')[0]).toEqual({
    argv: ['echo', 'x'],
    env: {},
    redirects: ['.git/config'],
  });
  expect(commands('echo x >> a 2> b < c')[0]?.redirects).toEqual([
    'a',
    'b',
    'c',
  ]);
  expect(commands('cmd 2>&1')[0]).toEqual({
    argv: ['cmd'],
    env: {},
    redirects: ['1'],
  });
  expect(commands('cmd &> out')[0]?.redirects).toEqual(['out']);
  expect(commands('cmd &>> out arg')[0]).toEqual({
    argv: ['cmd', 'arg'],
    env: {},
    redirects: ['out'],
  });
});

test('a cd earlier in the string is where the later commands run', () => {
  const cwds = (source: string) => commands(source).map(({ cwd }) => cwd);
  expect(cwds('cd /a && git pull')).toEqual([undefined, '/a']);
  expect(cwds('cd ~/x; cd y; git pull')).toEqual([undefined, '~/x', '~/x/y']);
  expect(cwds('cd rel && ls')).toEqual([undefined, 'rel']);
  expect(cwds('cd /a && cd /b && ls')).toEqual([undefined, '/a', '/b']);
  expect(cwds('cd - ; ls')).toEqual([undefined, undefined]);
  expect(cwds('pushd $HOME/x && ls')).toEqual([undefined, '$HOME/x']);
  // A cd inside `bash -c` moves that shell only.
  expect(cwds("bash -c 'cd /a && ls'; pwd")).toEqual([
    undefined,
    undefined,
    '/a',
    undefined,
  ]);
  // eval runs in this shell, so its cd stays.
  expect(cwds("eval 'cd /a'; pwd")).toEqual([undefined, undefined, '/a']);
});

test("program: the command's name without its folder", () => {
  const [command] = commands('/run/current-system/sw/bin/git pull');
  expect(command === undefined ? undefined : program(command)).toBe('git');
  expect(program({ argv: [], env: {}, redirects: [] })).toBe('');
});

test('expand: ~, $HOME and variables the environment knows; the rest is left as typed', () => {
  const environment = { HOME: '/home/owner', TMPDIR: '/tmp/t' };
  expect(expand('~/agent', environment)).toBe('/home/owner/agent');
  expect(expand('~', environment)).toBe('/home/owner');
  expect(expand('~owner/x', environment)).toBe('~owner/x');
  expect(expand('a/~/b', environment)).toBe('a/~/b');
  expect(expand('$HOME/agent', environment)).toBe('/home/owner/agent');
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, as typed.
  expect(expand('${TMPDIR}/before', environment)).toBe('/tmp/t/before');
  expect(expand('$UNKNOWN/x', environment)).toBe('$UNKNOWN/x');
  expect(expand('~/x', {})).toBe('~/x');
  expect(expand('$HOME/x', { HOME: undefined })).toBe('$HOME/x');
});
