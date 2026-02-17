import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';

const meta = {
  title: 'Core/Toast',
  parameters: {
    docs: {
      description: {
        component:
          'Toast notification system with success, failure, alert, and loading types.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    return (
      <>
        <ToastRegion />
        <div class="flex flex-col gap-2">
          <button
            class="px-4 py-2 bg-success/20 text-success-ink rounded hover:bg-success/30"
            onClick={() =>
              toast.success(
                'Action completed successfully',
                'Your changes have been saved'
              )
            }
          >
            Show Success Toast
          </button>
          <button
            class="px-4 py-2 bg-failure/20 text-failure-ink rounded hover:bg-failure/30"
            onClick={() =>
              toast.failure(
                'Action failed',
                'An error occurred while saving your changes'
              )
            }
          >
            Show Failure Toast
          </button>
          <button
            class="px-4 py-2 bg-alert/20 text-alert-ink rounded hover:bg-alert/30"
            onClick={() =>
              toast.alert(
                'Please check your input',
                'Some fields are missing or invalid'
              )
            }
          >
            Show Alert Toast
          </button>
          <button
            class="px-4 py-2 bg-success/20 text-success-ink rounded hover:bg-success/30"
            onClick={() =>
              toast.success('File deleted', 'The file has been removed', {
                text: 'Undo',
                onClick: () => console.log('Undo clicked'),
              })
            }
          >
            Show Success with Action
          </button>
        </div>
      </>
    );
  },
};
