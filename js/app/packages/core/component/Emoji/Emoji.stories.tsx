import { createSignal } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { EmojiButton } from './EmojiButton';
import { EmojiSelector } from './EmojiSelector';
import type { SimpleEmoji } from './emojis';

const meta = {
  title: 'Emoji',
  parameters: {
    docs: {
      description: {
        component:
          'Emoji button and selector components for displaying and picking emojis.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Button: Story = {
  render: () => {
    const sampleEmoji: SimpleEmoji = {
      emoji: '😀',
      slug: 'grinning-face',
      terms: ['grinning', 'face', 'smile'],
    };

    return (
      <div class="flex gap-2 items-center">
        <EmojiButton emoji={sampleEmoji} size="sm" />
        <EmojiButton emoji={sampleEmoji} size="md" />
        <EmojiButton emoji={sampleEmoji} size="lg" />
      </div>
    );
  },
};

export const Selector: Story = {
  render: () => {
    const [selected, setSelected] = createSignal<SimpleEmoji | null>(null);

    return (
      <div class="flex flex-col gap-4">
        {selected() && (
          <div class="text-sm">
            Selected: {selected()!.emoji} ({selected()!.slug})
          </div>
        )}
        <div class="border border-edge rounded-lg p-2 max-w-md max-h-96 overflow-auto">
          <EmojiSelector
            onEmojiClick={(emoji) => {
              setSelected(emoji);
              console.log('Selected emoji:', emoji);
            }}
          />
        </div>
      </div>
    );
  },
};
