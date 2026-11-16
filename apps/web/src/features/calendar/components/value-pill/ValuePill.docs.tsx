import { defineDoc } from '@app/features/ui-gallery/types';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { ValuePill } from './ValuePill';

// #region demo:states
function ValuePillDemo() {
  return (
    <div class="flex items-center gap-3 text-sm text-ink">
      <ValuePill>Fri, Nov 13</ValuePill>
      <ValuePill aria-haspopup="menu" aria-expanded={true}>
        Does not repeat
        <CaretDownIcon class="size-3 text-ink-extra-muted" />
      </ValuePill>
      <span>1h</span>
      <ValuePill disabled>Work</ValuePill>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Value pill',
  category: 'Inputs',
  description:
    'Quiet editable values, with an accent ring for open menus and plain read-only text.',
  guidelines: {
    do: ['Use a menu caret only for dropdown values.'],
    dont: ['Give read-only values an editable fill.'],
  },
  demos: [
    {
      id: 'states',
      title: 'Rest, open, read-only, and disabled',
      render: ValuePillDemo,
    },
  ],
});
