import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const androidPackage = 'com.macro.workspace.mobile';

const androidConfigPath = new URL(
  '../tauri/src-tauri/tauri.android.conf.json',
  import.meta.url
);
const maxVersionCode = 2_100_000_000;
const releaseConfigSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    bundle: z
      .object({
        android: z
          .object({
            versionCode: z.number().int().min(1).max(maxVersionCode),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export function androidReleaseMetadata(tag: string, config: unknown) {
  const match = /^v(20\d{2})\.(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?$/.exec(tag);
  if (!match || match[0] !== tag)
    throw new Error('Expected release tag vYYYY.M.D or vYYYY.M.D.N (N: 0–99)');
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('Release tag must contain a valid calendar date');
  const release = releaseConfigSchema.parse(config);
  return {
    version: release.version,
    versionCode: release.bundle.android.versionCode,
    filename: `macro-${tag}-android-arm64.apk`,
  };
}

export async function bumpAndroidVersionCode(
  path: string | URL = androidConfigPath
) {
  const config = releaseConfigSchema.parse(
    JSON.parse(await readFile(path, 'utf8'))
  );
  if (config.bundle.android.versionCode === maxVersionCode) {
    throw new Error('Android versionCode has reached the Google Play limit');
  }
  config.bundle.android.versionCode += 1;
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return config.bundle.android.versionCode;
}

const signingSchema = z.object({
  package_name: z.literal(androidPackage),
  keystore_base64: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  keystore_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  certificate_sha256: z.string().regex(/^(?:[a-fA-F0-9]{2}:?){32}$/),
  key_alias: z.string().min(1),
  key_password: z.string().min(1),
  store_password: z.string().min(1),
});

export function parseAndroidSigning(contents: string) {
  // Never include the input or parser diagnostics in an error: they contain secrets.
  let input: unknown;
  try {
    input = JSON.parse(contents);
  } catch {
    throw new Error('Invalid Android signing JSON');
  }
  const parsed = signingSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid Android signing configuration');
  const signing = parsed.data;
  const keystore = Buffer.from(signing.keystore_base64, 'base64');
  if (
    createHash('sha256').update(keystore).digest('hex') !==
    signing.keystore_sha256.toLowerCase()
  )
    throw new Error('Android keystore checksum mismatch');
  return { signing, keystore };
}

// java.util.Properties.load(InputStream) is Latin-1, with backslash escapes.
export function propertyValue(value: string) {
  return value.replace(
    /[\\\s:=#!\u0080-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

export async function provisionAndroidSigning(
  contents: string,
  directory: string,
  propertiesPath: string
) {
  const { signing, keystore } = parseAndroidSigning(contents);
  await mkdir(directory, { mode: 0o700 });
  const keystorePath = join(resolve(directory), 'upload-keystore.jks');
  const properties = {
    storeFile: keystorePath,
    storePassword: signing.store_password,
    keyAlias: signing.key_alias,
    keyPassword: signing.key_password,
  };
  await writeFile(keystorePath, keystore, { mode: 0o600, flag: 'wx' });
  const privateProperties = join(directory, 'keystore.properties');
  await writeFile(
    privateProperties,
    Object.entries(properties)
      .map(([key, value]) => `${key}=${propertyValue(value)}\n`)
      .join(''),
    { mode: 0o600, flag: 'wx' }
  );
  await writeFile(
    join(directory, 'certificate-sha256'),
    signing.certificate_sha256.replaceAll(':', '').toLowerCase(),
    { mode: 0o600, flag: 'wx' }
  );
  // Fail rather than replacing a developer's existing signing configuration.
  await symlink(resolve(privateProperties), propertiesPath);
}

function fetchSigning() {
  try {
    return execFileSync(
      'doppler',
      [
        'secrets',
        'get',
        'ANDROID_UPLOAD_SIGNING_JSON_V2',
        '--project',
        'android-release',
        '--config',
        'prd',
        '--plain',
        '--raw',
        '--no-check-version',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch {
    throw new Error(
      'Unable to fetch Android signing credentials. Install the Doppler CLI and authenticate with read access to android-release/prd (CI: DOPPLER_TOKEN). See docs/ANDROID_DEVELOPMENT.md.'
    );
  }
}

export async function ensureAndroidSigning(
  directory: string,
  propertiesPath: string
) {
  // Explicit local/CI configuration takes precedence over the shared local cache.
  if (existsSync(propertiesPath)) return;
  if (lstatSync(propertiesPath, { throwIfNoEntry: false })) {
    throw new Error(
      'Android keystore.properties is a broken symlink. Restore its signing files; see docs/ANDROID_DEVELOPMENT.md.'
    );
  }

  if (lstatSync(directory, { throwIfNoEntry: false })) {
    const properties = join(directory, 'keystore.properties');
    if (
      !existsSync(properties) ||
      !existsSync(join(directory, 'upload-keystore.jks'))
    ) {
      throw new Error(
        `Android signing directory ${directory} is incomplete. Restore its signing files or provision signing manually; see docs/ANDROID_DEVELOPMENT.md.`
      );
    }
    await symlink(resolve(properties), propertiesPath);
    return;
  }

  console.log(`Provisioning Android release signing in ${directory}`);
  await provisionAndroidSigning(fetchSigning(), directory, propertiesPath);
}

export function verifyAndroidApk(
  apk: string,
  buildTools: string,
  expectedCertificate: string,
  metadata: ReturnType<typeof androidReleaseMetadata>
) {
  const certificates = execFileSync(
    join(buildTools, 'apksigner'),
    ['verify', '--verbose', '--print-certs', apk],
    { encoding: 'utf8' }
  );
  const fingerprints = [
    ...certificates.matchAll(
      /^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)$/gm
    ),
  ].map((match) => match[1].toLowerCase());
  if (
    fingerprints.length !== 1 ||
    fingerprints[0] !== expectedCertificate.trim()
  )
    throw new Error(
      'APK was not signed with the expected Android release certificate'
    );
  execFileSync(join(buildTools, 'zipalign'), ['-c', '-P', '16', '4', apk]);
  const badging = execFileSync(
    join(buildTools, 'aapt'),
    ['dump', 'badging', apk],
    {
      encoding: 'utf8',
    }
  );
  const expected = `package: name='${androidPackage}' versionCode='${metadata.versionCode}' versionName='${metadata.version}'`;
  if (
    !badging.startsWith(expected) ||
    !/^native-code: 'arm64-v8a'\s*$/m.test(badging) ||
    /^application-debuggable/m.test(badging)
  )
    throw new Error(
      'APK package, version, architecture, or release mode is incorrect'
    );
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'bump' && args.length === 0) {
      console.log(await bumpAndroidVersionCode());
    } else if (command === 'metadata' && args.length === 2) {
      const [tag, destination] = args;
      const metadata = androidReleaseMetadata(
        tag,
        JSON.parse(await readFile(androidConfigPath, 'utf8'))
      );
      await writeFile(
        destination,
        JSON.stringify({
          version: metadata.version,
          bundle: { android: { versionCode: metadata.versionCode } },
        })
      );
      console.log(metadata.filename);
    } else if (command === 'signing' && args.length === 2) {
      await provisionAndroidSigning(fetchSigning(), args[0], args[1]);
    } else if (command === 'ensure-signing' && args.length === 2) {
      await ensureAndroidSigning(args[0], args[1]);
    } else if (command === 'verify' && args.length === 4) {
      const [tag, apk, buildTools, certificateFile] = args;
      verifyAndroidApk(
        apk,
        buildTools,
        await readFile(certificateFile, 'utf8'),
        androidReleaseMetadata(
          tag,
          JSON.parse(await readFile(androidConfigPath, 'utf8'))
        )
      );
    } else {
      throw new Error(
        'Usage: android-release.ts bump | metadata TAG CONFIG | signing DIRECTORY PROPERTIES | ensure-signing DIRECTORY PROPERTIES | verify TAG APK BUILD_TOOLS CERTIFICATE_FILE'
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Android release preparation failed'
    );
    process.exitCode = 1;
  }
}
