import { vi } from 'vitest';
import type {
  ComposeNoticeOptions,
  EmailComposeContext,
} from '../context/compose-capabilities';

type Tone = 'success' | 'failure' | 'alert';
type OpenNotice = {
  tone: Tone;
  message: string;
  options: ComposeNoticeOptions | undefined;
};

/**
 * Stands in for the toaster: notices change in place when they name an open
 * one to replace, as the app's do, and every operation is logged in order.
 */
export function recordNotices(context: EmailComposeContext) {
  const { feedback } = context.notices;
  const open = new Map<number, OpenNotice>();
  const log: string[] = [];
  let lastId = 0;

  const show =
    (tone: Tone) => (message: string, options?: ComposeNoticeOptions) => {
      const replaced =
        options?.replace !== undefined && open.has(options.replace)
          ? options.replace
          : undefined;
      const id = replaced ?? ++lastId;
      open.set(id, { tone, message, options });
      const undo = options?.actions?.some(({ label }) => label === 'Undo');
      log.push(
        `${replaced === undefined ? 'open' : 'update'} ${id} ${tone}: ${message}${undo ? ' [Undo]' : ''}`
      );
      return id;
    };
  vi.mocked(feedback.success).mockImplementation(show('success'));
  vi.mocked(feedback.failure).mockImplementation(show('failure'));
  vi.mocked(feedback.alert).mockImplementation(show('alert'));
  const close = (id: number, how: 'dismiss' | 'expire') => {
    const notice = open.get(id);
    if (!notice) return;
    open.delete(id);
    log.push(`${how} ${id}`);
    notice.options?.onDismiss?.();
  };
  vi.mocked(feedback.dismiss).mockImplementation((id) => close(id, 'dismiss'));

  return {
    log,
    /** Notices on screen, oldest first. */
    open: () => [...open.values()],
    /** Closes every notice on screen as its timer, or the user, would. */
    expireAll: () => {
      for (const id of [...open.keys()]) close(id, 'expire');
    },
    /** Presses Undo on the notice offering it. */
    pressUndo: () =>
      [...open.values()]
        .flatMap(({ options }) => options?.actions ?? [])
        .find(({ label }) => label === 'Undo')
        ?.onClick(),
  };
}
