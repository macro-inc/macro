import '@app/index.css';
import { EmojiReactionPopover } from '@app/features/channel/Message/EmojiReactionPopover';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

function Fixture() {
  const [open, setOpen] = createSignal(false);
  const [picked, setPicked] = createSignal('');
  return (
    <div class="p-40">
      <EmojiReactionPopover
        open={open()}
        onOpenChange={setOpen}
        onEmojiSelect={setPicked}
        placement="bottom"
        trigger={<span>React</span>}
      />
      <output data-testid="picked">{picked()}</output>
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
