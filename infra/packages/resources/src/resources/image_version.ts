import type * as pulumi from '@pulumi/pulumi';

/**
 * A container's version: the first 12 hex digits of its image digest.
 * Datadog marks a deploy when the version changes, and an unchanged image
 * keeps the same version, so the task definition only changes when the image
 * does.
 */
export function imageVersion(imageUri: string): string {
  const digest = /@sha256:([0-9a-f]{12})[0-9a-f]*$/.exec(imageUri);
  if (!digest) {
    throw new Error(`Image URI has no sha256 digest: ${imageUri}`);
  }
  return digest[1];
}

/**
 * The container env entry that reports `imageVersion` as the OpenTelemetry
 * `service.version` resource attribute, which Datadog reads as `version`.
 * The Rust SDK reads `OTEL_RESOURCE_ATTRIBUTES` from the process
 * environment, so a container `environment` entry reaches it.
 */
export function versionEnvironment(imageUri: pulumi.Output<string>) {
  return {
    name: 'OTEL_RESOURCE_ATTRIBUTES',
    value: imageUri.apply((uri) => `service.version=${imageVersion(uri)}`),
  };
}
