import { scrollToRenderedTarget } from '../scroll-to-rendered-target';

const discussion = document.querySelector<HTMLElement>('#discussion')!;
let cancel: (() => void) | undefined;
document.querySelector('#navigate')!.addEventListener('click', () => {
  cancel?.();
  cancel = scrollToRenderedTarget(discussion, 'target');
});
