undef $/; $_=<STDIN>;
my $t = <<'T';
  it('keeps sends still waiting after a delivered one, in the order written', () => {
    testQueryClient.setQueryData<MessageTimelineData>(timelineKey(), {
      pageParams: [null],
      pages: [
        {
          entries: [{ type: 'message', message: item(parent) }],
          next_cursor: null,
          previous_cursor: null,
        },
      ],
    });
    const shown = () =>
      timelineMessages(
        testQueryClient.getQueryData<MessageTimelineData>(timelineKey())!
          .pages[0]
      ).map((row) => row.id);
    const first = message(parent, 'first');
    applyMessage({ ...first, created_at: '2026-09-09T00:00:01Z' }, 'posted');
    applyMessage(
      { ...message(parent, 'second'), created_at: '2026-09-09T00:00:02Z' },
      'posted'
    );
    const sending = testQueryClient.getMutationCache().build(testQueryClient, {
      mutationKey: SEND_MESSAGE_MUTATION_KEY,
      mutationFn: () => new Promise<void>(() => {}),
    });
    fireAndForget(sending.execute({ optimisticId: 'second' }), 'test');

    // The server took the first later than the second was written.
    applyQueuedWrite({ ...first, created_at: '2026-09-09T00:00:03Z' }, 'posted');

    expect(shown()).toEqual(['second', 'first', 'root']);
  });
T
s/(  it\("confirms only a person's own reaction over what was pushed since")/$t$1/ or die 1;
s/(import \{ afterEach, beforeEach, describe, expect, it, vi \} from 'vitest';\n)/$1import { SEND_MESSAGE_MUTATION_KEY } from '..\/unsent';\n/ or die 2;
print;
