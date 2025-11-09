import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import EditableField from './EditableField';

const meta = {
  title: 'EditableField',
  component: EditableField,
  argTypes: {
    allowEmpty: {
      control: { type: 'boolean' },
    },
  },
} satisfies Meta<typeof EditableField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Project Name',
    value: 'My Project',
    placeholder: 'Enter project name',
    onSave: (value: string) => console.log('Saved:', value),
    allowEmpty: false,
  },
};
