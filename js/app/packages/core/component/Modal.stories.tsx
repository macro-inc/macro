import { createSignal } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { DeprecatedTextButton } from './DeprecatedTextButton';
import { DeprecatedButton } from './FormControls/DeprecatedButton';
import { ButtonBar, Content, Header, Message, Modal, Overlay } from './Modal';

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
        <DeprecatedTextButton
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
                <DeprecatedButton
                  size="Base"
                  theme="secondary"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </DeprecatedButton>
                <DeprecatedButton
                  size="Base"
                  theme="primary"
                  onClick={() => setOpen(false)}
                >
                  Confirm
                </DeprecatedButton>
              </ButtonBar>
            </Content>
          </Overlay>
        </Modal>
      </>
    );
  },
};
