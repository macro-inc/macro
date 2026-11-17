import { formatLocale } from '@app/lib/i18n';
import { parseLocalDate } from '@core/util/local-date';
import { Button } from '@ui';

const compactDate = (date: Date) =>
  new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);

export function RangeDateTrigger(props: {
  date: string;
  label: string;
  placeholder: string;
  active: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onClick: (element: HTMLButtonElement) => void;
}) {
  const valueLabel = () => {
    const date = parseLocalDate(props.date);
    return date ? compactDate(date) : props.placeholder;
  };
  return (
    <Button
      variant="value"
      size={props.fullWidth ? 'field' : 'sm'}
      fullWidth={props.fullWidth}
      class={props.fullWidth ? 'justify-start' : undefined}
      aria-label={props.label}
      aria-haspopup="dialog"
      aria-expanded={props.active}
      aria-invalid={props.invalid || undefined}
      aria-describedby={props.describedBy}
      data-expanded={props.active ? '' : undefined}
      disabled={props.disabled}
      onClick={(event) => props.onClick(event.currentTarget)}
    >
      {valueLabel()}
    </Button>
  );
}
