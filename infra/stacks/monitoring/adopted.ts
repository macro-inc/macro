import * as datadog from '@pulumi/datadog';

/**
 * A monitor that already exists in Datadog and was adopted into this stack by
 * `pulumi import` (see README). `protect` is the point: these monitors predate
 * the stack, several of them page on-call, and a program that no longer declares
 * one would otherwise delete it on the next deploy. Protected resources fail the
 * deploy instead.
 *
 * To retire a monitor, drop `protect` in its own commit, then delete it.
 */
export function adopted(
  name: string,
  args: datadog.MonitorArgs
): datadog.Monitor {
  return new datadog.Monitor(name, args, { protect: true });
}
