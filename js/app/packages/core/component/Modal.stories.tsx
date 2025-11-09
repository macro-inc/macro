import { createSignal } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { Button } from './FormControls/Button';
import { ButtonBar, Content, Header, Message, Modal, Overlay } from './Modal';
import { TextButton } from './TextButton';

const meta = {
  title: 'Modal',
  parameters: {
    docs: {
      description: {
        component:
          'Modal dialog system built on Corvu Dialog. Includes Overlay, Content, Header, Message, and ButtonBar components.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [open, setOpen] = createSignal(false);

    return (
      <>
        <TextButton
          text="Open Modal"
          theme="base"
          onClick={() => setOpen(true)}
        />
        <Modal open={open()} onOpenChange={setOpen}>
          <Overlay>
            <Content>
              <Header>Modal Title</Header>
              <Message>
                This is a modal dialog. It demonstrates the standard modal
                pattern with overlay, header, message, and action buttons.
              </Message>
              <ButtonBar>
                <Button
                  size="Base"
                  theme="secondary"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="Base"
                  theme="primary"
                  onClick={() => setOpen(false)}
                >
                  Confirm
                </Button>
              </ButtonBar>
            </Content>
          </Overlay>
        </Modal>
      </>
    );
  },
};
