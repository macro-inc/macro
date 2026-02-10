import { describe, expect, it } from 'vitest';
import {
  createMessageListContextLookup,
  type MinimalMessage,
} from '../utils/listContext';

type TestMessage = MinimalMessage & { thread_id?: string };

describe('createMessageListContextLookup', () => {
  const mockMessages: TestMessage[] = [
    {
      id: 'msg0',
      created_at: '2024-01-01T10:00:00Z',
      sender_id: 'user1',
    },
    {
      id: 'msg1',
      created_at: '2024-01-01T10:00:00Z',
      sender_id: 'user1',
    },
    {
      id: 'msg2',
      created_at: '2024-01-01T10:01:00Z',
      sender_id: 'user2',
      thread_id: 'msg1',
    },
    {
      id: 'msg3',
      created_at: '2024-01-01T10:02:00Z',
      sender_id: 'user1',
      thread_id: 'msg1',
    },
    {
      id: 'msg4',
      created_at: '2024-01-01T10:03:00Z',
      sender_id: 'user3',
    },
  ];

  const getThreadId = (m: TestMessage) => m.thread_id;

  const neverNewMessage = () => false;
  const alwaysNewMessage = () => true;

  it('should create context for all messages', () => {
    const context = createMessageListContextLookup({
      messages: mockMessages,
      isNewMessageFn: neverNewMessage,
      getThreadId,
    });

    expect(Object.keys(context)).toHaveLength(5);
    expect(context).toHaveProperty('msg0');
    expect(context).toHaveProperty('msg1');
    expect(context).toHaveProperty('msg2');
    expect(context).toHaveProperty('msg3');
    expect(context).toHaveProperty('msg4');
  });

  it('should set correct indices', () => {
    const context = createMessageListContextLookup({
      messages: mockMessages,
      isNewMessageFn: neverNewMessage,
      getThreadId,
    });

    expect(context.msg0.index).toBe(0);
    expect(context.msg1.index).toBe(1);
    expect(context.msg2.index).toBe(2);
    expect(context.msg3.index).toBe(3);
    expect(context.msg4.index).toBe(4);
  });

  it('should calculate thread indices correctly', () => {
    const context = createMessageListContextLookup({
      messages: mockMessages,
      isNewMessageFn: neverNewMessage,
      getThreadId,
    });

    expect(context.msg0.threadIndex).toBe(-1);
    expect(context.msg1.threadIndex).toBe(-1);
    expect(context.msg2.threadIndex).toBe(0);
    expect(context.msg3.threadIndex).toBe(1);
    expect(context.msg4.threadIndex).toBe(-1);
  });

  it('should identify new messages for non-threaded messages only', () => {
    const context = createMessageListContextLookup({
      messages: mockMessages,
      isNewMessageFn: alwaysNewMessage,
      getThreadId,
    });

    // All non threaded messages are new (if new function is always true)
    expect(context.msg1.isNewMessage).toBe(true);
    expect(context.msg1.isNewMessage).toBe(true);
    expect(context.msg2.isNewMessage).toBe(false);
    expect(context.msg3.isNewMessage).toBe(false);
    expect(context.msg4.isNewMessage).toBe(true);
  });

  it('should set previous non-threaded messages correctly', () => {
    const context = createMessageListContextLookup({
      messages: mockMessages,
      isNewMessageFn: neverNewMessage,
      getThreadId,
    });

    expect(context.msg1.previousNonThreadedMessage?.id).toBe('msg0');
    expect(context.msg2.previousNonThreadedMessage?.id).toBe('msg0');
    expect(context.msg3.previousNonThreadedMessage?.id).toBe('msg0');
    expect(context.msg4.previousNonThreadedMessage?.id).toBe('msg1');
  });

  it('should identify parent new messages', () => {
    const isMsg1New = (msg: TestMessage) => {
      return getThreadId(msg) ? getThreadId(msg) === 'msg1' : msg.id === 'msg1';
    };

    const context = createMessageListContextLookup({
      messages: mockMessages,
      isNewMessageFn: isMsg1New,
      getThreadId,
    });

    expect(context.msg1.isNewMessage).toBe(true);
    expect(context.msg1.isParentNewMessage).toBe(false);
    expect(context.msg2.isParentNewMessage).toBe(true);
    expect(context.msg3.isParentNewMessage).toBe(true);
    expect(context.msg4.isParentNewMessage).toBe(false);
  });

  it('should identify messages in the last thread when messages are threaded to last top-level', () => {
    const messagesWithLastThread: TestMessage[] = [
      {
        id: 'msg0',
        created_at: '2024-01-01T10:00:00Z',
        sender_id: 'user1',
      },
      {
        id: 'msg1',
        created_at: '2024-01-01T10:01:00Z',
        sender_id: 'user2',
      },
      {
        id: 'msg2',
        created_at: '2024-01-01T10:02:00Z',
        sender_id: 'user3',
        thread_id: 'msg1',
      },
      {
        id: 'msg3',
        created_at: '2024-01-01T10:03:00Z',
        sender_id: 'user1',
        thread_id: 'msg1',
      },
    ];

    const context = createMessageListContextLookup({
      messages: messagesWithLastThread,
      isNewMessageFn: neverNewMessage,
      getThreadId,
    });

    // msg1 is the last top-level message
    expect(context.msg0.isInLastThread).toBe(false);
    expect(context.msg1.isInLastThread).toBe(false);

    // msg2 and msg3 are threaded to msg1, which is the last top-level message
    expect(context.msg2.isInLastThread).toBe(true);
    expect(context.msg3.isInLastThread).toBe(true);
  });
});
