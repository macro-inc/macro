import CalendarBlank from '@icon/system/regular/calendar-blank.svg';
import CalendarDots from '@icon/system/regular/calendar-dots.svg';
import CaretCircleDown from '@icon/system/regular/caret-circle-down.svg';
import CheckSquare from '@icon/system/regular/check-square.svg';
import CircleDashed from '@icon/system/regular/circle-dashed.svg';
import Clock from '@icon/system/regular/clock.svg';
import CurrencyDollar from '@icon/system/regular/currency-dollar.svg';
import Hash from '@icon/system/regular/hash.svg';
import Percent from '@icon/system/regular/percent.svg';
import TextT from '@icon/system/regular/text-t.svg';
import User from '@icon/system/regular/user.svg';
import type { TableColumnType } from '@macro-inc/spreadsheet/sheet-tables';
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
