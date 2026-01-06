import type { Meta, StoryObj } from 'storybook-solidjs-vite';

/**
 * Extracts the play function context type from a Story.
 *
 * @example
 * const meta = { ... } satisfies Meta<typeof MyComponent>;
 * type Story = StoryObj<typeof meta>;
 *
 * export const Example: Story = {
 *   play: async ({ canvas, userEvent, args }: PlayContext<Story>) => {
 *     // fully typed!
 *   },
 * };
 */
export type PlayContext<TStory extends StoryObj<Meta<any>>> = Parameters<
  NonNullable<TStory['play']>
>[0];
