import Calendar from '@icon/system/regular/calendar.svg';
import CalendarBlank from '@icon/system/regular/calendar-blank.svg';
import CaretCircleDown from '@icon/system/regular/caret-circle-down.svg';
import CheckSquare from '@icon/system/regular/check-square.svg';
import CheckSquareOffset from '@icon/system/regular/check-square-offset.svg';
import Cube from '@icon/system/regular/cube.svg';
import FileText from '@icon/system/regular/file-text.svg';
import Hash from '@icon/system/regular/hash.svg';
import Link from '@icon/system/regular/link.svg';
import ListNumbers from '@icon/system/regular/list-numbers.svg';
import RadioButton from '@icon/system/regular/radio-button.svg';
import Table from '@icon/system/regular/table.svg';
import Tag from '@icon/system/regular/tag.svg';
import TextAa from '@icon/system/regular/text-aa.svg';
import TextAlignLeft from '@icon/system/regular/text-align-left.svg';
import UploadSimple from '@icon/system/regular/upload-simple.svg';
import User from '@icon/system/regular/user.svg';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { QuestionTypeId } from '../core/question-types';

const ICONS: Record<
  QuestionTypeId,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  short: TextAa,
  paragraph: TextAlignLeft,
  number: Hash,
  choice: RadioButton,
  checkboxes: CheckSquare,
  dropdown: CaretCircleDown,
  file: UploadSimple,
  datetime: Calendar,
  date: CalendarBlank,
  url: Link,
  checkbox: CheckSquareOffset,
  person: User,
  document: FileText,
  relation: Table,
  'number-dropdown': ListNumbers,
  tags: Tag,
  entity: Cube,
};

export function QuestionTypeIcon(props: {
  type: QuestionTypeId;
  class?: string;
}) {
  return (
    <Dynamic
      component={ICONS[props.type]}
      class={props.class ?? 'size-4'}
      aria-hidden="true"
    />
  );
}
