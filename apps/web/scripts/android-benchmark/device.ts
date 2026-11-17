import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const ANDROID_PACKAGE = 'com.macro.workspace.mobile';
const ACTIVITY = `${ANDROID_PACKAGE}/.MainActivity`;
/** Longer than any adb call the harness makes; a stalled one fails the step. */
const ADB_TIMEOUT_MS = 60_000;

/** One emulator or device, addressed by serial on every adb call. */
export class Device {
  constructor(readonly serial: string) {}

  async adb(...args: string[]): Promise<string> {
    const { stdout } = await run('adb', ['-s', this.serial, ...args], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: ADB_TIMEOUT_MS,
    });
    return stdout;
  }

  shell(command: string): Promise<string> {
    return this.adb('shell', command);
  }

  /** Device wall clock in epoch milliseconds, which WebView span times use. */
  async now(): Promise<number> {
    return Number(BigInt((await this.shell('date +%s%N')).trim()) / 1000000n);
  }

  async pid(): Promise<number | undefined> {
    const output = (await this.shell(`pidof ${ANDROID_PACKAGE} || true`)).trim();
    return output ? Number(output.split(/\s+/)[0]) : undefined;
  }

  async forceStop(): Promise<void> {
    await this.shell(`am force-stop ${ANDROID_PACKAGE}`);
  }

  /** Starts the app's activity and returns the device time just before. */
  async launch(): Promise<number> {
    const output = await this.shell(
      `date +%s%N; am start -n ${ACTIVITY} >/dev/null`
    );
    return Number(BigInt(output.trim().split('\n')[0]) / 1000000n);
  }

  /** Taps, or with `holdMs` presses that long, as a stationary swipe. */
  async tap(x: number, y: number, holdMs?: number): Promise<void> {
    const at = `${Math.round(x)} ${Math.round(y)}`;
    await this.shell(holdMs ? `input swipe ${at} ${at} ${holdMs}` : `input tap ${at}`);
  }

  /** The WebView DevTools socket of the app's process, once it exists. */
  async devtoolsSocket(pid: number): Promise<string | undefined> {
    const sockets = await this.shell('cat /proc/net/unix');
    const name = `webview_devtools_remote_${pid}`;
    return sockets.split('\n').some((line) => line.trim().endsWith(`@${name}`))
      ? name
      : undefined;
  }

  async forward(port: number, socket: string): Promise<void> {
    await this.adb('forward', `tcp:${port}`, `localabstract:${socket}`);
  }

  async removeForward(port: number): Promise<void> {
    await this.adb('forward', '--remove', `tcp:${port}`).catch(() => '');
  }

  async properties(): Promise<Record<string, string>> {
    const keys = [
      'ro.build.version.release',
      'ro.build.version.sdk',
      'ro.product.cpu.abi',
      'ro.product.model',
      'ro.hardware.egl',
      'ro.kernel.qemu',
    ];
    const values = await Promise.all(
      keys.map(async (key) => (await this.shell(`getprop ${key}`)).trim())
    );
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  }

  async packageVersion(): Promise<string> {
    const dump = await this.shell(`dumpsys package ${ANDROID_PACKAGE}`);
    const name = /versionName=(\S+)/.exec(dump)?.[1] ?? 'unknown';
    const code = /versionCode=(\d+)/.exec(dump)?.[1] ?? 'unknown';
    return `${name} (${code})`;
  }

  async webviewVersion(): Promise<string> {
    const dump = await this.shell('dumpsys webviewupdate');
    return /Current WebView package \(name, version\): \(([^)]*)\)/.exec(
      dump
    )?.[1] ?? 'unknown';
  }
}
