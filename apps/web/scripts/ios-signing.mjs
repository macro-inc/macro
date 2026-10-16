// Explicit App Store export signing for an imported distribution identity.
// Tauri derives signingStyle from the Xcode project, overriding ExportOptions.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function records(api, pathname) {
  const result = [];
  while (pathname) {
    const page = await api(pathname);
    result.push(...page.data);
    pathname = page.links?.next
      ? new URL(page.links.next).pathname + new URL(page.links.next).search
      : null;
  }
  return result;
}

export async function signingProfiles(api, identifiers, certificateId) {
  const profiles = await records(
    api,
    "/v1/profiles?filter[profileType]=IOS_APP_STORE&include=bundleId,certificates&limit=200",
  );
  const selected = {};
  for (const identifier of identifiers) {
    // Apple's identifier filter also returns extensions when querying the app.
    const bundles = await records(
      api,
      `/v1/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=200`,
    );
    const bundle = bundles.find((record) => record.attributes.identifier === identifier);
    if (!bundle) throw new Error(`No registered Apple bundle ID for ${identifier}.`);
    let profile = profiles.find((record) =>
      record.attributes.profileState === "ACTIVE" &&
      Date.parse(record.attributes.expirationDate) > Date.now() &&
      record.relationships.bundleId.data?.id === bundle.id &&
      record.relationships.certificates.data?.some((cert) => cert.id === certificateId),
    );
    if (!profile) {
      profile = (await api("/v1/profiles", {
        method: "POST",
        body: {
          data: {
            type: "profiles",
            attributes: {
              name: `Macro CI ${identifier} ${certificateId} ${Date.now()}`,
              profileType: "IOS_APP_STORE",
            },
            relationships: {
              bundleId: { data: { type: "bundleIds", id: bundle.id } },
              certificates: { data: [{ type: "certificates", id: certificateId }] },
            },
          },
        },
      })).data;
    }
    if (!profile.attributes.uuid || !profile.attributes.profileContent) {
      throw new Error(`Apple returned an incomplete provisioning profile for ${identifier}.`);
    }
    selected[identifier] = profile.attributes;
  }
  return selected;
}

export function manualSigningProject(project) {
  if (!/CODE_SIGN_STYLE = (Automatic|Manual);/.test(project)) {
    throw new Error("No CODE_SIGN_STYLE found in the generated Apple project.");
  }
  return project.replaceAll(/CODE_SIGN_STYLE = (Automatic|Manual);/g, "CODE_SIGN_STYLE = Manual;");
}

export async function prepareSigning(api, appDir) {
  const certificatePath = process.env.APPLE_DISTRIBUTION_CERTIFICATE_PATH;
  if (!certificatePath) throw new Error("APPLE_DISTRIBUTION_CERTIFICATE_PATH is required.");
  // Only the public certificate leaves openssl; the password stays in its env.
  const pem = execFileSync(
    "/usr/bin/openssl",
    ["pkcs12", "-in", certificatePath,
      "-passin", "env:APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD", "-clcerts", "-nokeys"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const certificate = new X509Certificate(pem);
  const certificates = await records(api, "/v1/certificates?limit=200");
  const registered = certificates.find((record) =>
    record.attributes.certificateType === "DISTRIBUTION" &&
    new X509Certificate(Buffer.from(record.attributes.certificateContent, "base64"))
      .fingerprint === certificate.fingerprint,
  );
  if (!registered || Date.parse(registered.attributes.expirationDate) <= Date.now()) {
    throw new Error("The supplied Apple Distribution certificate is expired or not registered with this API key's team.");
  }
  const team = certificate.subject.match(/(?:^|\n)OU=([^\n]+)/)?.[1];
  if (!team) throw new Error("The distribution certificate has no team identifier.");

  const projectDir = path.join(appDir, "tauri/src-tauri/gen/apple");
  const projectPath = path.join(projectDir, "app.xcodeproj/project.pbxproj");
  const project = readFileSync(projectPath, "utf8");
  const identifiers = [...new Set(
    [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g)]
      .map((match) => match[1]),
  )];
  if (!identifiers.length) throw new Error("No bundle identifiers found in the Apple project.");
  const profiles = await signingProfiles(api, identifiers, registered.id);
  const directory = path.join(os.homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const [identifier, profile] of Object.entries(profiles)) {
    writeFileSync(
      path.join(directory, `${profile.uuid}.mobileprovision`),
      Buffer.from(profile.profileContent, "base64"),
      { mode: 0o600 },
    );
    console.log(`App Store profile for ${identifier}: ${profile.name}`);
  }
  const exportPath = path.join(projectDir, "ExportOptions.plist");
  const options = JSON.parse(execFileSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", exportPath],
    { encoding: "utf8" },
  ));
  Object.assign(options, {
    signingStyle: "manual",
    signingCertificate: certificate.fingerprint.replaceAll(":", ""),
    teamID: team,
    provisioningProfiles: Object.fromEntries(
      Object.entries(profiles).map(([identifier, profile]) => [identifier, profile.uuid]),
    ),
  });
  const plist = execFileSync(
    "/usr/bin/plutil",
    ["-convert", "xml1", "-o", "-", "--", "-"],
    { input: JSON.stringify(options) },
  );
  writeFileSync(projectPath, manualSigningProject(project));
  writeFileSync(exportPath, plist);
  console.log(`Prepared manual App Store export for team ${team}.`);
}
