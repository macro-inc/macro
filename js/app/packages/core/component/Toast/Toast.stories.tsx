import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { TextButton } from '../TextButton';
import { toast } from './Toast';
import { ToastRegion } from './ToastRegion';

const meta = {
  title: 'Toast',
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
          <TextButton
            text="Show Success Toast"
            theme="base"
            onClick={() =>
              toast.success(
                'Action completed successfully',
                'Your changes have been saved'
              )
            }
          />
          <TextButton
            text="Show Failure Toast"
            theme="base"
            onClick={() =>
              toast.failure(
                'Action failed',
                'An error occurred while saving your changes'
              )
            }
          />
          <TextButton
            text="Show Alert Toast"
            theme="base"
            onClick={() =>
              toast.alert(
                'Please check your input',
                'Some fields are missing or invalid'
              )
            }
          />
          <TextButton
            text="Show Success with Action"
            theme="base"
            onClick={() =>
              toast.success('File deleted', 'The file has been removed', {
                text: 'Undo',
                onClick: () => console.log('Undo clicked'),
              })
            }
          />
        </div>
      </>
    );
  },
};
