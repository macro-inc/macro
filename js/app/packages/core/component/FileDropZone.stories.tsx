import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { FileDropZone } from './FileDropZone';

const meta = {
  title: 'FileDropZone',
  component: FileDropZone,
  parameters: {
    docs: {
      description: {
        component:
          'A drag-and-drop file upload zone with file type validation.',
      },
    },
  },
} satisfies Meta<typeof FileDropZone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/gif'],
    acceptedExtensions: ['png', 'jpg', 'jpeg', 'gif'],
    onFilesDrop: (files: File[]) => {
      console.log('Files dropped:', files);
    },
    disableClick: false,
    children: (
      <div class="border-2 border-dashed border-edge rounded-lg p-8 text-center text-ink-muted">
        <p>Drop files here or click to browse</p>
        <p class="text-xs mt-2">Accepts: PNG, JPG, GIF</p>
      </div>
    ),
  },
};
