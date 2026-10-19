import type { TableColumnType } from '@macro-inc/spreadsheet/sheet-tables';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import CalendarDots from '@phosphor/calendar-dots.svg';
import CaretCircleDown from '@phosphor/caret-circle-down.svg';
import CheckSquare from '@phosphor/check-square.svg';
import CircleDashed from '@phosphor/circle-dashed.svg';
import Clock from '@phosphor/clock.svg';
import CurrencyDollar from '@phosphor/currency-dollar.svg';
import Hash from '@phosphor/hash.svg';
import Percent from '@phosphor/percent.svg';
import TextT from '@phosphor/text-t.svg';
import User from '@phosphor/user.svg';
import { Dynamic } from 'solid-js/web';

const ICONS = {
  text: TextT,
  number: Hash,
  percent: Percent,
  currency: CurrencyDollar,
  date: CalendarBlank,
  datetime: CalendarDots,
  time: Clock,
  checkbox: CheckSquare,
  dropdown: CaretCircleDown,
  person: User,
} satisfies Record<TableColumnType, unknown>;

/** A table column type's icon; an untyped column's is a dashed circle. */
export function TableColumnTypeIcon(props: {
  type: TableColumnType | undefined;
  class?: string;
}) {
  return (
    <Dynamic
      component={props.type ? ICONS[props.type] : CircleDashed}
      class={props.class}
      aria-hidden="true"
    />
  );
}
