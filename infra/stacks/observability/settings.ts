// The host's runtime settings, carried in its EC2 user data.
export interface Settings {
  region: string;
  // The observability cluster's ingest hostname, where host Alloy sends.
  otlpHost: string;
  oncallHost: string;
  secretArn: string;
  volumeId: string;
  // GoAlert's nightly dumps go under `goalert/` in it.
  backupBucket: string;
}

export function validateRegion(region: string): void {
  if (region !== 'us-east-2') {
    throw new Error(
      'Observability must run in us-east-2, outside prod us-east-1'
    );
  }
}

export function validateRegionalArn(
  arn: string,
  service: 'sns' | 'secretsmanager',
  region: string
): void {
  const parts = arn.split(':');
  if (
    parts[0] !== 'arn' ||
    parts[1] !== 'aws' ||
    parts[2] !== service ||
    parts[3] !== region ||
    !/^\d{12}$/.test(parts[4]) ||
    (service === 'sns' &&
      (parts.length !== 6 || !/^[a-zA-Z0-9_-]+$/.test(parts[5])))
  ) {
    throw new Error(`${service} ARN must reference ${region}`);
  }
}

// Validate runtime values before they reach the NixOS configuration renderer.
export function validateSettings(settings: Settings): void {
  const hosts = [settings.otlpHost, settings.oncallHost];
  for (const host of hosts) {
    if (!/^[a-z0-9-]+\.macro-internal\.com$/.test(host)) {
      throw new Error(
        'Observability hostnames must be subdomains of macro-internal.com'
      );
    }
  }
  if (new Set(hosts).size !== hosts.length) {
    throw new Error('Ingestion and on-call require separate hostnames');
  }
  if (
    !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[a-zA-Z0-9/_+=.@-]+$/.test(
      settings.secretArn
    )
  ) {
    throw new Error(
      'secretArn must reference an existing Secrets Manager secret'
    );
  }
  validateRegion(settings.region);
  validateRegionalArn(settings.secretArn, 'secretsmanager', settings.region);
  if (!/^vol-[a-f0-9]+$/.test(settings.volumeId)) {
    throw new Error('Invalid data volume ID');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(settings.backupBucket)) {
    throw new Error('Invalid backup bucket name');
  }
}
