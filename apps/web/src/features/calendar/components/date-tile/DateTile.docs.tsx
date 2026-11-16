import { defineDoc } from '@app/features/ui-gallery/types';
import { DateTile } from './DateTile';

// #region demo:ranges
function DateTileDemo() {
  return (
    <div class="flex items-center gap-6">
      <DateTile month="NOV" day="13" color="var(--color-blue-ink)" />
      <DateTile month="DEC" day="2–4" color="var(--color-violet-ink)" />
      <DateTile month="NOV" day="30" color="var(--color-green-ink)" />
      <DateTile month="NOV" day="19" color="var(--color-blue-ink)" compact />
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Date tile',
  category: 'Data Display',
  description:
    'A calendar-colored date marker with same-month range and compact search variants.',
  guidelines: {
    do: ['Keep full date and time in the event text.'],
    dont: ['Show an exclusive end date as an occupied day.'],
  },
  demos: [
    {
      id: 'ranges',
      title: 'Day, range, across months, and compact',
      render: DateTileDemo,
    },
  ],
});
