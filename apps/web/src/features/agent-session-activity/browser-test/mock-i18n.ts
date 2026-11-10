import agentWork from '../../../lib/i18n/locales/en/agent-work';

type Message = string | { one?: string; other: string };

/** English `agentWork` messages, so the fixture never drifts from the app's text. */
export function t(key: string, args?: Record<string, string | number>): string {
  const name = key.replace(/^agentWork\./, '');
  const message = (agentWork as Record<string, Message>)[name];
  if (message === undefined) return key;
  const text =
    typeof message === 'string'
      ? message
      : args?.count === 1 && message.one
        ? message.one
        : message.other;
  return text.replace(/\{\{(\w+)\}\}/g, (_, field: string) =>
    String(args?.[field] ?? '')
  );
}
