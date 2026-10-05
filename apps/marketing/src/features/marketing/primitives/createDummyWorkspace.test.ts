import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDummyWorkspace } from './createDummyWorkspace';

const disposals: (() => void)[] = [];
function setup() {
  return createRoot((dispose) => {
    disposals.push(dispose);
    return createDummyWorkspace();
  });
}
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

describe('sample workspace commands', () => {
  it('opens Home items in place while explicit rail navigation changes sections', () => {
    const w = setup();
    w.openItem('tasks', 'announcement');
    expect(w.view()).toBe('home');
    expect(w.contentView()).toBe('tasks');
    expect(w.selected()).toBe('announcement');
    w.openItem('messages', 'launch');
    expect(w.view()).toBe('home');
    expect(w.contentView()).toBe('messages');
    expect(w.channel()).toBe('launch');
    w.backToCollection('messages');
    expect(w.contentView()).toBe('home');
    expect(w.selected()).toBeUndefined();
    w.open('tasks');
    w.openItem('tasks', 'announcement');
    expect(w.view()).toBe('tasks');
    w.backToCollection('tasks');
    expect(w.view()).toBe('tasks');
    expect(w.selected()).toBeUndefined();
  });

  it('keeps recipients and schedules local without inserting an unsent reply', () => {
    const w = setup();
    w.openItem('email', 'dana');
    const original = w.data.emails.find((email) => email.id === 'dana')!;
    const replies = original.replies.length;
    w.sendEmail(
      'Re: Next steps',
      'Scheduled reply',
      'Dana',
      'dana',
      'Tomorrow at 9 AM',
      { cc: 'julia@example.com' }
    );
    expect(w.data.emails[0]).toMatchObject({
      folder: 'scheduled',
      scheduled: 'Tomorrow at 9 AM',
      to: 'Dana',
      cc: 'julia@example.com',
    });
    expect(original.replies).toHaveLength(replies);
    w.sendEmail('Re: Next steps', 'Ready now', 'Dana', 'dana', undefined, {
      cc: 'julia@example.com',
      bcc: 'teo@example.com',
    });
    expect(
      w.data.emails.find((email) => email.id === 'dana')!.replies.at(-1)
    ).toMatchObject({
      body: 'Ready now',
      to: 'Dana',
      cc: 'julia@example.com',
      bcc: 'teo@example.com',
    });
    expect(w.view()).toBe('home');
    expect(w.contentView()).toBe('email');
    expect(w.selected()).toBe('dana');
  });
  it('preserves task edits across views and isolates workspace instances', () => {
    const w = setup();
    const other = setup();
    w.updateTask('announcement', {
      title: 'Review launch',
      status: 'Completed',
      owner: 'teo',
    });
    w.comment('announcement', '  Ready for review  ');
    w.open('messages');
    const link = w.data.channels
      .find((item) => item.id === 'launch')
      ?.messages.find((message) => message.id === 'm1')?.taskId;
    w.open('tasks', link);
    const task = w.data.tasks.find((item) => item.id === w.selected());
    expect(task).toMatchObject({
      title: 'Review launch',
      status: 'Completed',
      owner: 'teo',
    });
    expect(task?.comments.at(-1)?.body).toBe('Ready for review');
    expect(other.data.tasks.find((item) => item.id === link)?.title).toBe(
      'Write the launch announcement'
    );
  });

  it('shares references to the same email and document in the selected channel', () => {
    const w = setup();
    w.setChannel('customers');
    w.shareEmail('dana');
    expect(w.view()).toBe('home');
    expect(w.contentView()).toBe('messages');
    expect(
      w.data.channels.find((item) => item.id === 'customers')?.messages.at(-1)
        ?.emailId
    ).toBe('dana');
    expect(w.data.emails.find((item) => item.id === 'dana')?.shared).toBe(
      'customers'
    );
    w.post('Rollout plan', undefined, undefined, 'rollout');
    expect(
      w.data.channels.find((item) => item.id === 'customers')?.messages.at(-1)
        ?.documentId
    ).toBe('rollout');
  });

  it('records replies in their thread and Sent, rejecting blank sends', () => {
    const w = setup();
    const count = w.data.emails.length;
    w.sendEmail('Re: Next steps', 'See you Thursday.', 'Dana', 'dana');
    expect(w.data.emails).toHaveLength(count + 1);
    expect(w.data.emails[0]).toMatchObject({
      folder: 'sent',
      body: 'See you Thursday.',
    });
    expect(
      w.data.emails.find((item) => item.id === 'dana')?.replies.at(-1)?.body
    ).toBe('See you Thursday.');
    expect(w.selected()).toBe('dana');
    w.sendEmail('', 'No subject', 'Dana');
    expect(w.data.emails).toHaveLength(count + 1);
  });

  it('scripted agent uses current state and creates an editable task', () => {
    vi.useFakeTimers();
    const w = setup();
    w.updateTask('announcement', {
      title: 'Current launch task',
      status: 'In Progress',
    });
    w.ask('Summarize tasks');
    vi.advanceTimersByTime(450);
    expect(w.agentReplies()[0].answer).toContain('Current launch task');
    w.ask('Create task: Prepare the demo');
    vi.advanceTimersByTime(450);
    expect(w.data.tasks.find((item) => item.id === w.selected())?.title).toBe(
      'Prepare the demo'
    );
  });

  it('keeps company and calendar edits local and resets the new views', () => {
    const w = setup();
    const other = setup();
    w.createCompany();
    const id = w.selected();
    w.setData('companies', (company) => company.id === id, {
      name: 'Test company',
      stage: 'Demo',
    });
    w.open('home');
    expect(w.data.companies.find((company) => company.id === id)?.stage).toBe(
      'Demo'
    );
    expect(other.data.companies.some((company) => company.id === id)).toBe(
      false
    );
    w.setCalendarDate('2026-10-02');
    w.createEvent();
    expect(w.data.events.find((event) => event.id === w.selected())?.date).toBe(
      '2026-10-02'
    );
    w.setFileView('Shared with me');
    w.reset();
    expect(w.data.companies.length).toBe(other.data.companies.length);
    expect(w.data.events.length).toBe(other.data.events.length);
    expect(w.fileView()).toBe('My Files');
    expect(w.calendarDate()).toBe('2026-09-29');
  });

  it('keeps replies associated with the original message and channel', () => {
    const w = setup();
    w.setChannel('dm-julia');
    const channel = w.data.channels.find((item) => item.id === 'dm-julia')!;
    w.post(
      'Ready for review',
      undefined,
      undefined,
      undefined,
      channel.messages[0].id
    );
    expect(channel.messages.at(-1)).toMatchObject({
      body: 'Ready for review',
      replyTo: channel.messages[0].id,
    });
    expect(
      w.data.channels
        .find((item) => item.id === 'launch')
        ?.messages.some((item) => item.body === 'Ready for review')
    ).toBe(false);
  });

  it('reset cancels pending agent work and restores all sample data', () => {
    vi.useFakeTimers();
    const w = setup();
    const count = w.data.tasks.length;
    w.createTask('Temporary');
    w.setChannel('product');
    w.post('Temporary message');
    w.ask('Create task: Late task');
    w.reset();
    vi.advanceTimersByTime(1000);
    expect(w.data.tasks).toHaveLength(count);
    expect(w.agentReplies()).toEqual([]);
    expect(w.channel()).toBe('launch');
    expect(w.view()).toBe('home');
    expect(w.busy()).toBe(false);
    expect(
      w.data.channels
        .find((item) => item.id === 'product')
        ?.messages.some((item) => item.body === 'Temporary message')
    ).toBe(false);
  });
});
