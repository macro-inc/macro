import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

// These projects match the dev/prod FCM credentials used by notification-service.
const projects = { dev: 'macro-app-dev-12ae0', build: 'macro-app-955f1' };
const configSchema = z.object({
  project_info: z.object({ project_id: z.string() }),
  client: z.array(
    z.object({
      client_info: z.object({
        android_client_info: z.object({ package_name: z.string() }),
      }),
    })
  ),
});

export function validateAndroidFirebase(
  config: unknown,
  action: 'dev' | 'build'
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
  if (parsed.data.project_info.project_id !== projects[action])
    throw new Error(
      `Firebase config for ${action} must use ${projects[action]}`
    );
}

if (import.meta.main) {
  const [action, source, destination] = process.argv.slice(2);
  if ((action !== 'dev' && action !== 'build') || !source || !destination)
    throw new Error(
      'Usage: android-firebase.ts {dev|build} source destination'
    );
  validateAndroidFirebase(await Bun.file(source).json(), action);
  if (resolve(source) !== resolve(destination))
    await copyFile(source, destination);
}
