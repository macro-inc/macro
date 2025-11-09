import { createMemo, createSignal } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ActionSequence } from './ActionSequence';

const meta = {
  title: 'Rebranded/core/FormControls/ActionSequence',
  component: ActionSequence,
  argTypes: {
    steps: {
      control: { type: 'object' },
      description:
        'Array of step objects with label, onClick, disabled, and completed properties',
    },
  },
} satisfies Meta<typeof ActionSequence>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [step1Completed, setStep1Completed] = createSignal(false);
    const [step2Completed, setStep2Completed] = createSignal(false);
    const [step3Completed, setStep3Completed] = createSignal(false);

    const handleStep1Click = () => {
      console.log('Step 1 clicked');
      setStep1Completed(true);
    };

    const handleStep2Click = () => {
      console.log('Step 2 clicked');
      setStep2Completed(true);
    };

    const handleStep3Click = () => {
      console.log('Step 3 clicked');
      setStep3Completed(true);
    };

    const steps = createMemo(() => [
      {
        label: 'Authenticate with Google',
        onClick: handleStep1Click,
        disabled: false,
        completed: step1Completed(),
      },
      {
        label: 'Connect your Inbox',
        onClick: handleStep2Click,
        disabled: !step1Completed(),
        completed: step2Completed(),
      },
      {
        label: 'Start Your Subscription',
        onClick: handleStep3Click,
        disabled: !step2Completed(),
        completed: step3Completed(),
      },
    ]);

    return <ActionSequence steps={steps()} />;
  },
};
