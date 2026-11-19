undef $/; $_=<STDIN>;
my $t = <<'T';
  it('moves a delivered send below messages the server placed before it', () => {
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
    // Written offline, so shown with the time it was written.
    const mine = message(parent, 'mine');
    applyMessage({ ...mine, created_at: '2026-09-09T00:00:01Z' }, 'posted');
    // Pushed on reconnecting: the server took it while this device was away.
    applyMessage(
      { ...message(parent, 'theirs'), created_at: '2026-09-09T00:00:02Z' },
      'posted'
    );
    expect(shown()).toEqual(['theirs', 'mine', 'root']);

    applyQueuedWrite({ ...mine, created_at: '2026-09-09T00:00:03Z' }, 'posted');

    expect(shown()).toEqual(['mine', 'theirs', 'root']);
  });
T
s/(  it\("confirms only a person's own reaction over what was pushed since")/$t$1/ or die 1;
print;
