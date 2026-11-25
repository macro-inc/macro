import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg?component-solid';
import ExclamationIcon from '@icon/system/regular/exclamation-mark.svg?component-solid';
import type {
  ComposeNoticeOptions,
  EmailComposeFeedback,
} from './context/compose-capabilities';

const notice = (options?: ComposeNoticeOptions) => {
  const hasUndo = options?.actions?.some(({ kind }) => kind === 'undo');
  const hasNavigation = options?.actions?.some(({ kind }) => kind === 'open');
  return {
    ...options,
    dismissStyle: hasUndo || hasNavigation ? ('icon' as const) : undefined,
    actionLayout: hasUndo ? ('inline' as const) : undefined,
    actions: options?.actions?.map(({ kind, ...action }) => {
      if (kind === 'save' || kind === 'open') return action;
      return {
        ...action,
        icon: ArrowCounterClockwise,
      };
    }),
  };
};

export const composeToastFeedback: EmailComposeFeedback['feedback'] = {
  success: (message, options) => toast.success(message, notice(options)),
  failure: (message, options) => {
    if (options?.persistent) {
      const isDraftRecovery = options.actions?.some(
        ({ kind }) => kind === 'save'
      );
      return toast.custom(
        {
          title: message,
          dismissLabel: t('common.maybeLater'),
          content: () => options.subtext,
          icon: ExclamationIcon,
          color: 'var(--color-failure)',
          titleColor: 'var(--color-failure)',
          actions: notice(options).actions,
        },
        {
          persistent: true,
          dismissStyle: isDraftRecovery ? 'icon' : undefined,
          replace: options.replace,
          onDismiss: options.onDismiss,
        }
      );
    }
    return toast.failure(message, notice(options));
  },
  alert: (message, options) => toast.alert(message, notice(options)),
  dismiss: toast.dismiss,
};
