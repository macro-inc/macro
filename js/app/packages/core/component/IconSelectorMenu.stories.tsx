import type { Component } from 'solid-js';
import { createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { IconSelectorMenu } from './IconSelectorMenu';
import { TextButton } from './TextButton';

const meta = {
  title: 'IconSelectorMenu',
  component: IconSelectorMenu,
  parameters: {
    docs: {
      description: {
        component:
          'A menu for selecting icons from a curated set of Phosphor icons.',
      },
    },
  },
} satisfies Meta<typeof IconSelectorMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [show, setShow] = createSignal(false);
    const [selectedIcon, setSelectedIcon] = createSignal<Component | null>(
      null
    );

    return (
      <div class="p-4">
        <div class="mb-4 flex items-center gap-4">
          <TextButton
            text={show() ? 'Close Icon Selector' : 'Open Icon Selector'}
            theme="base"
            onClick={() => setShow(!show())}
          />

          {selectedIcon() && (
            <div class="flex items-center gap-2 text-sm text-ink-muted">
              <span>Selected:</span>
              <Dynamic component={selectedIcon()!} />
            </div>
          )}
        </div>

        <IconSelectorMenu
          show={() => show()}
          setShow={setShow}
          onIconSelect={(icon) => {
            setSelectedIcon(() => icon);
            console.log('Icon selected:', icon);
          }}
        />
      </div>
    );
  },
};

export const WithColor: Story = {
  render: () => {
    const [show, setShow] = createSignal(true);
    const [selectedIcon, setSelectedIcon] = createSignal<Component | null>(
      null
    );

    return (
      <div class="p-4">
        <div class="mb-4 flex items-center gap-4">
          <TextButton
            text={show() ? 'Close' : 'Open'}
            theme="base"
            onClick={() => setShow(!show())}
          />

          {selectedIcon() && (
            <div class="flex items-center gap-2 text-sm text-accent">
              <span>Selected (blue):</span>
              <Dynamic component={selectedIcon()!} />
            </div>
          )}
        </div>

        <IconSelectorMenu
          show={() => show()}
          setShow={setShow}
          onIconSelect={(icon) => {
            setSelectedIcon(() => icon);
            console.log('Icon selected:', icon);
          }}
          color="blue"
        />
      </div>
    );
  },
};
