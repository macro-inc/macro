import { defineDoc } from '@app/features/ui-gallery/types';
import { CalendarSwatch } from './CalendarSwatch';

// #region demo:colors
function CalendarSwatchDemo() {
  return (
    <div class="flex items-center gap-6 text-sm text-ink">
      <span class="flex items-center gap-2">
        <CalendarSwatch color="var(--color-blue-ink)" />
        Work
      </span>
      <span class="flex items-center gap-2">
        <CalendarSwatch color="var(--color-violet-ink)" />
        Focus
      </span>
      <span class="flex items-center gap-2">
        <CalendarSwatch color="var(--color-green-ink)" />
        Personal
      </span>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Calendar swatch',
  category: 'Data Display',
  description: 'A resolved calendar color beside its title or source name.',
  propTypes: ['CalendarSwatchProps'],
  demos: [
    {
      id: 'colors',
      title: 'Source colors',
      render: CalendarSwatchDemo,
    },
  ],
});
