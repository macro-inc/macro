export interface Settings {
  region: string;
  grafanaHost: string;
  otlpHost: string;
  secretArn: string;
  alarmTopicArn: string;
  volumeId: string;
  logsBucket: string;
  tracesBucket: string;
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
  for (const host of [settings.grafanaHost, settings.otlpHost]) {
    if (!/^[a-z0-9-]+\.macro-internal\.com$/.test(host)) {
      throw new Error(
        'Observability hostnames must be subdomains of macro-internal.com'
      );
    }
  }
  if (settings.grafanaHost === settings.otlpHost) {
    throw new Error('UI and ingestion require separate hostnames');
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
  validateRegionalArn(settings.alarmTopicArn, 'sns', settings.region);
  if (!/^vol-[a-f0-9]+$/.test(settings.volumeId)) {
    throw new Error('Invalid data volume ID');
  }
  for (const bucket of [settings.logsBucket, settings.tracesBucket]) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error('Invalid telemetry bucket name');
    }
  }
}
