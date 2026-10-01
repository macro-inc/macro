import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import pins from './android-firebase.lock.json';

// These projects match the dev/prod FCM credentials used by notification-service.
const projects = { dev: 'macro-app-dev-12ae0', build: 'macro-app-955f1' };
const configSchema = z.object({
  project_info: z.object({
    project_id: z.string().min(1),
    project_number: z.string().min(1),
  }),
  client: z.array(
    z.object({
      client_info: z.object({
        mobilesdk_app_id: z.string().min(1),
        android_client_info: z.object({ package_name: z.string() }),
      }),
      api_key: z.array(z.object({ current_key: z.string().min(1) })).min(1),
    })
  ),
});

export function validateAndroidFirebase(
  config: unknown,
  action: 'dev' | 'build',
  allowCustomProject = false
) {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success)
    throw new Error('Invalid Android Firebase configuration');
  if (
    !parsed.data.client.some(
      (client) =>
        client.client_info.android_client_info.package_name ===
        'com.macro.app.prod'
    )
  )
    throw new Error('Firebase config must contain com.macro.app.prod');
  const project = parsed.data.project_info.project_id;
  if (
    project !== projects[action] &&
    (!allowCustomProject || Object.values(projects).includes(project))
  )
    throw new Error(
      `Firebase config for ${action} must use ${projects[action]}`
    );
}

export function fetchAndroidFirebase(pin: (typeof pins)['dev']) {
  let contents: string;
  try {
    contents = execFileSync(
      'doppler',
      [
        'secrets',
        'get',
        pin.secret,
        '--project',
        pin.project,
        '--config',
        pin.config,
        '--plain',
        '--raw',
        '--no-check-version',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    throw new Error(
      `Unable to fetch Android Firebase config from Doppler ${pin.project}/${pin.config}. Install the Doppler CLI and authenticate with access to this config (CI: DOPPLER_TOKEN), or pass --firebase-config. See docs/ANDROID_DEVELOPMENT.md.`
    );
  }
  if (createHash('sha256').update(contents).digest('hex') !== pin.sha256)
    throw new Error(
      'Android Firebase config checksum mismatch. Restore the pinned Doppler value or review an update to android-firebase.lock.json.'
    );
  return contents;
}

export async function prepareAndroidFirebase(
  action: 'dev' | 'build',
  source: string,
  destination: string
) {
  const pinned = source === '--doppler';
  const contents = pinned
    ? fetchAndroidFirebase(pins[action])
    : await readFile(source, 'utf8');
  let config: unknown;
  try {
    config = JSON.parse(contents);
  } catch {
    throw new Error('Invalid Android Firebase configuration JSON');
  }
  validateAndroidFirebase(config, action, !pinned);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = await mkdtemp(join(dirname(destination), '.firebase-'));
  try {
    const file = join(temporary, 'google-services.json');
    await writeFile(file, contents, { mode: 0o600 });
    await rename(file, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [action, source, destination] = process.argv.slice(2);
  if ((action !== 'dev' && action !== 'build') || !source || !destination)
    throw new Error(
      'Usage: android-firebase.ts {dev|build} {--doppler|source} destination'
    );
  try {
    await prepareAndroidFirebase(action, source, destination);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Firebase setup failed'
    );
    process.exitCode = 1;
  }
}
