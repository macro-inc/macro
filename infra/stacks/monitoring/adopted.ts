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
  // All imported monitors allow partial evaluation windows. The provider
  // defaults to true when omitted, which would change their alert behavior.
  // Datadog omits host delay when group delay applies. Keep the provider's
  // default explicit after normalizing imported state; group delay wins.
  return new datadog.Monitor(
    name,
    { requireFullWindow: false, newHostDelay: 300, ...args },
    { protect: true }
  );
}
