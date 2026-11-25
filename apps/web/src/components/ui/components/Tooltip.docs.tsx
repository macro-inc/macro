import { defineDoc } from '@app/features/ui-gallery/types';
import { Tooltip } from './Tooltip';

// #region demo:truncated
function TruncatedDemo() {
  let title!: HTMLSpanElement;
  return (
    <Tooltip.Root measureTarget={() => title}>
      <Tooltip.Trigger class="max-w-40 truncate" as="button">
        <span ref={title} class="block truncate">
          A conversation title that does not fit in the available space
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content>
          A conversation title that does not fit in the available space
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
// #endregion

export default defineDoc({
  name: 'Tooltip',
  category: 'Feedback',
  description:
    'Tooltips open on desktop hover or keyboard focus. Compound roots accept measureTarget to show content only when the measured element overflows horizontally, checking again at each opening.',
  exports: ['Tooltip'],
  import: "import { Tooltip } from '@ui';",
  demos: [
    {
      id: 'truncated',
      title: 'Truncated title',
      description:
        'Resize the viewport and focus the title to check its overflow.',
      render: TruncatedDemo,
    },
  ],
});
