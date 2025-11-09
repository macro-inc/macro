import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { Markdown } from './Markdown';

const meta = {
  title: 'Markdown',
  component: Markdown,
  parameters: {
    docs: {
      description: {
        component: 'Markdown renderer using remark and rehype plugins.',
      },
    },
  },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: `# Heading 1

## Heading 2

This is a paragraph with **bold** and *italic* text.

- List item 1
- List item 2
- List item 3

\`\`\`javascript
const hello = 'world';
console.log(hello);
\`\`\`

> This is a blockquote

[Link example](https://example.com)`,
  },
};
