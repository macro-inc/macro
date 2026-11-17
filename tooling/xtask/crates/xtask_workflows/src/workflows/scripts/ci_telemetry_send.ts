// Send the collected CI telemetry to the OTLP logs route. Best effort, never fails the job.

import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const ATTEMPTS = 2;
const TIMEOUT_MILLISECONDS = 10_000;
const RETRY_DELAY_MILLISECONDS = 2_000;

/** Read the `Authorization=Bearer%20...` form the credential step writes. */
export function authorization(headers: string): [string, string] {
  const separator = headers.indexOf('=');
  return [headers.slice(0, separator), decodeURIComponent(headers.slice(separator + 1))];
}

async function send(url: string, body: Buffer, header: [string, string]) {
  const response = await fetch(url, {
    method: 'POST',
    body: gzipSync(body),
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      [header[0]]: header[1],
    },
    signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.status;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('A required environment variable is missing');
  return value;
}

async function sendEvents() {
  const started = performance.now();
  const path = required('CI_TELEMETRY_EVENTS');
  if (!existsSync(path)) {
    console.log('Nothing to send');
    return;
  }
  const body = readFileSync(path);
  const header = authorization(required('OTLP_HEADERS'));
  const url = required('OTLP_LOGS_URL');
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const status = await send(url, body, header);
      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
      console.log(`Sent ${body.length} bytes, HTTP ${status}, ${elapsed} s`);
      return;
    } catch (error) {
      // Only the class, so neither the header nor a response reaches the log.
      const reason = error instanceof Error ? error.constructor.name : 'unknown error';
      console.log(`::warning::CI telemetry send attempt ${attempt} failed: ${reason}`);
      if (attempt < ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MILLISECONDS));
      }
    }
  }
}

/** Entry point, called by the workflow step and never by an import. */
export async function main() {
  try {
    await sendEvents();
  } catch (error) {
    const reason = error instanceof Error ? error.constructor.name : 'unknown error';
    console.log(`::warning::CI telemetry not sent: ${reason}`);
  }
}
