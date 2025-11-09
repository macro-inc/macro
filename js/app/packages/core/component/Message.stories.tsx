import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { Message } from './Message';

const meta = {
  title: 'Message',
  parameters: {
    docs: {
      description: {
        component:
          'Message component for displaying chat/channel messages with threading support.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleMessage: Story = {
  render: () => (
    <div class="w-full max-w-2xl bg-panel p-4">
      <Message
        focused={false}
        senderId="user-1"
        isFirstMessage={true}
        isLastMessage={true}
        isConsecutive={false}
      >
        <Message.TopBar name="John Doe" timestamp={new Date().toISOString()} />
        <Message.Body>
          This is a single message with a timestamp and user name.
        </Message.Body>
      </Message>
    </div>
  ),
};

export const ThreadedMessages: Story = {
  render: () => (
    <div class="w-full max-w-2xl bg-panel p-4 space-y-2">
      {/* Root message */}
      <Message
        focused={false}
        senderId="user-1"
        isFirstMessage={true}
        isLastMessage={false}
        isConsecutive={false}
        threadDepth={0}
        hasThreadChildren={true}
      >
        <Message.TopBar
          name="Alice"
          timestamp={new Date(Date.now() - 3600000).toISOString()}
        />
        <Message.Body>
          This is the root message. It has replies below.
        </Message.Body>
      </Message>

      {/* First reply */}
      <Message
        focused={false}
        senderId="user-2"
        isFirstMessage={false}
        isLastMessage={false}
        isConsecutive={false}
        threadDepth={1}
        isFirstInThread={true}
      >
        <Message.TopBar
          name="Bob"
          timestamp={new Date(Date.now() - 1800000).toISOString()}
        />
        <Message.Body>This is the first reply in the thread.</Message.Body>
      </Message>

      {/* Second reply */}
      <Message
        focused={false}
        senderId="user-3"
        isFirstMessage={false}
        isLastMessage={true}
        isConsecutive={false}
        threadDepth={1}
        isLastInThread={true}
      >
        <Message.TopBar name="Charlie" timestamp={new Date().toISOString()} />
        <Message.Body>
          And this is another reply in the same thread!
        </Message.Body>
      </Message>
    </div>
  ),
};

export const ConsecutiveMessages: Story = {
  render: () => (
    <div class="w-full max-w-2xl bg-panel p-4 space-y-1">
      {/* First message from user */}
      <Message
        focused={false}
        senderId="user-1"
        isFirstMessage={true}
        isLastMessage={false}
        isConsecutive={false}
      >
        <Message.TopBar name="Alice" timestamp={new Date().toISOString()} />
        <Message.Body>First message from Alice</Message.Body>
      </Message>

      {/* Consecutive message - no avatar/name shown */}
      <Message
        focused={false}
        senderId="user-1"
        isFirstMessage={false}
        isLastMessage={false}
        isConsecutive={true}
      >
        <Message.TopBar name="Alice" />
        <Message.Body>Second message from Alice (consecutive)</Message.Body>
      </Message>

      {/* Another consecutive message */}
      <Message
        focused={false}
        senderId="user-1"
        isFirstMessage={false}
        isLastMessage={true}
        isConsecutive={true}
      >
        <Message.TopBar name="Alice" />
        <Message.Body>Third message from Alice (also consecutive)</Message.Body>
      </Message>
    </div>
  ),
};

export const FocusedMessage: Story = {
  render: () => (
    <div class="w-full max-w-2xl bg-panel p-4">
      <Message
        focused={true}
        senderId="user-1"
        isFirstMessage={true}
        isLastMessage={true}
        isConsecutive={false}
      >
        <Message.TopBar
          name="Focused User"
          timestamp={new Date().toISOString()}
        />
        <Message.Body>
          This message is focused (has active bracket styling).
        </Message.Body>
      </Message>
    </div>
  ),
};

export const DeletedMessage: Story = {
  render: () => (
    <div class="w-full max-w-2xl bg-panel p-4">
      <Message
        focused={false}
        senderId="user-1"
        isFirstMessage={true}
        isLastMessage={true}
        isConsecutive={false}
        isDeleted={true}
      >
        <Message.TopBar
          name="Deleted User"
          timestamp={new Date().toISOString()}
        />
        <Message.Body isDeleted={true}>
          This message has been deleted.
        </Message.Body>
      </Message>
    </div>
  ),
};
