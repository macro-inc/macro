// The bench's stand-in on the stack's network: a Caddy container that
// answers for PostHog and for one email_service route. Start the stack with
// `--env-file crates/suggestion_generation/bench/stack.env` so the services
// point at it:
//
// - `:8080` answers PostHog's `/flags` with `flags.json`, which the bench
//   writes before each section (generations read flags fresh at each start),
//   and accepts and drops analytics.
// - `:8081` answers `/internal/recent_messages/macro|{email}` with the
//   persona's newest mail from `inbox/{email}.json`, and the same route
//   asked for the month (`?days=30&limit=500&texts=100&snippet_chars=500`,
//   the read the finding step makes) with it from `window/{email}.json`, and
//   refuses any other window for that person, since the file holds that month
//   alone: the routines brief reads mail from Gmail or Outlook, which seeded
//   mail never reaches. Every other request, and a person with no file, goes
//   to the real email_service.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { WINDOW_DAYS, WINDOW_MESSAGES, WINDOW_SNIPPET_CHARS, WINDOW_TEXTS } from './personas';

const ALIAS = 'suggestions-bench-stub';
const IMAGE = 'caddy:2-alpine';

const CADDYFILE = `{
	auto_https off
	admin off
}
:8080 {
	handle /flags* {
		root * /srv
		rewrite * /flags.json
		# PostHog's client asks with POST; the file server answers only GET.
		method GET
		header Content-Type application/json
		file_server
	}
	respond \`{"status":1}\` 200
}
:8081 {
	# The regexp's capture is set only once its matcher has run, so the file
	# check is a second matcher inside the first one's handler.
	@recent path_regexp user ^/internal/recent_messages/macro\\|(.+)$
	handle @recent {
		root * /srv
		@window {
			query days=${WINDOW_DAYS} limit=${WINDOW_MESSAGES} texts=${WINDOW_TEXTS} snippet_chars=${WINDOW_SNIPPET_CHARS}
			file /window/{re.user.1}.json
		}
		handle @window {
			rewrite * /window/{re.user.1}.json
			header Content-Type application/json
			file_server
		}
		@otherWindow {
			query days=*
			file /window/{re.user.1}.json
		}
		handle @otherWindow {
			respond "the bench's stand-in serves only days=${WINDOW_DAYS}&limit=${WINDOW_MESSAGES}&texts=${WINDOW_TEXTS}&snippet_chars=${WINDOW_SNIPPET_CHARS}" 400
		}
		@inbox {
			not query days=*
			file /inbox/{re.user.1}.json
		}
		handle @inbox {
			rewrite * /inbox/{re.user.1}.json
			header Content-Type application/json
			file_server
		}
		handle {
			reverse_proxy email-service:8080
		}
	}
	handle {
		reverse_proxy email-service:8080
	}
}
`;

/** Where an instance's stand-in keeps its files. */
export const stubDir = (instance: string) => join(homedir(), '.cache/suggestions-bench', instance, 'stub');

const container = (instance: string) => `macro-${instance}-suggestions-bench-stub`;

function docker(args: string[], allowFail = false) {
  const result = Bun.spawnSync(['docker', ...args], { stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0 && !allowFail) {
    throw new Error(`docker ${args.join(' ')}: ${result.stderr.toString().trim() || result.exitCode}`);
  }
  return result.stdout.toString().trim();
}

/** Start the stand-in on `instance`'s network, or leave a running one be. */
export function startStub(instance: string) {
  const dir = stubDir(instance);
  mkdirSync(join(dir, 'inbox'), { recursive: true });
  mkdirSync(join(dir, 'window'), { recursive: true });
  writeFileSync(join(dir, 'Caddyfile'), CADDYFILE);
  if (!existsSync(join(dir, 'flags.json'))) writeFlags(instance, {});
  const name = container(instance);
  const running = docker(['ps', '-q', '--filter', `name=^${name}$`]);
  if (running) {
    // Caddy reads its file once; a changed one needs a restart.
    docker(['restart', name]);
    return;
  }
  docker(['rm', '-f', name], true);
  docker([
    'run', '-d', '--name', name, '--restart', 'unless-stopped',
    '--network', `macro-${instance}_services`, '--network-alias', ALIAS,
    '-v', `${dir}:/srv:ro`, '-v', `${join(dir, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    IMAGE,
  ]);
}

export function stopStub(instance: string) {
  docker(['rm', '-f', container(instance)], true);
}

/** Flags on for everyone, by key; every other flag is off. */
export function writeFlags(instance: string, on: Record<string, boolean>) {
  const flags = Object.fromEntries(
    Object.entries(on)
      .filter(([, enabled]) => enabled)
      .map(([key]) => [key, { key, enabled: true }]),
  );
  writeFileSync(join(stubDir(instance), 'flags.json'), JSON.stringify({ flags, errorsWhileComputingFlags: false }));
}

/** Serve `newest` as `email`'s newest mail, and `month` as their mail of a window of days. */
export function writeInbox(instance: string, email: string, newest: unknown, month: unknown) {
  // A stand-in started before the month read has no folder for it.
  mkdirSync(join(stubDir(instance), 'window'), { recursive: true });
  writeFileSync(join(stubDir(instance), 'inbox', `${email}.json`), JSON.stringify(newest));
  writeFileSync(join(stubDir(instance), 'window', `${email}.json`), JSON.stringify(month));
}

export function clearInbox(instance: string, email: string) {
  for (const folder of ['inbox', 'window']) rmSync(join(stubDir(instance), folder, `${email}.json`), { force: true });
}

/** Ask the stand-in, from inside the network, what it serves for `path` on `port`. */
export function probe(instance: string, port: number, path: string): string {
  return docker([
    'run', '--rm', '--network', `macro-${instance}_services`, 'alpine',
    'wget', '-qO-', `http://${ALIAS}:${port}${path}`,
  ]);
}
