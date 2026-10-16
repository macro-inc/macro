import Calendar from '@phosphor/calendar.svg';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import CaretCircleDown from '@phosphor/caret-circle-down.svg';
import CheckSquare from '@phosphor/check-square.svg';
import CheckSquareOffset from '@phosphor/check-square-offset.svg';
import Cube from '@phosphor/cube.svg';
import FileText from '@phosphor/file-text.svg';
import Hash from '@phosphor/hash.svg';
import Link from '@phosphor/link.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import RadioButton from '@phosphor/radio-button.svg';
import Table from '@phosphor/table.svg';
import Tag from '@phosphor/tag.svg';
import TextAa from '@phosphor/text-aa.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import UploadSimple from '@phosphor/upload-simple.svg';
import User from '@phosphor/user.svg';
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
