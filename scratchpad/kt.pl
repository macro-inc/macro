undef $/; $_=<STDIN>;
# first: 'waits for the device to be asked'
s/(    noteChannelPush\(CHANNEL_ID, 8\);\n\n    let stored: boolean \| undefined;\n    const waiting = pushesStored\(CHANNEL_ID\)\.then\(\(answer\) => \{\n      stored = answer;\n    \}\);\n)    await vi\.advanceTimersByTimeAsync\(100\);\n    expect\(stored\)\.toBeUndefined\(\);\n\n    await vi\.advanceTimersByTimeAsync\(200\);\n/$1    expect(stored).toBeUndefined();\n\n    await vi.advanceTimersByTimeAsync(0);\n/ or die 1;
s/(      stored = await pushesStored\(CHANNEL_ID, '7'\);\n    \}\)\(\);\n)    await vi\.advanceTimersByTimeAsync\(100\);\n    expect\(stored\)\.toBeUndefined\(\);\n    await vi\.advanceTimersByTimeAsync\(200\);\n/$1    expect(stored).toBeUndefined();\n    await vi.advanceTimersByTimeAsync(0);\n/ or die 2;
my $t = <<'T';

  it('asks the log again for a push it did not have yet', async () => {
    vi.useFakeTimers();
    const host = sequencedHost('7');
    channelCacheHost.mockReturnValue(host);
    let logSeq = '7';
    getGraphqlSoupClientMock(() => changes({ seq: logSeq }));

    noteChannelPush(CHANNEL_ID, 8);
    await vi.advanceTimersByTimeAsync(0);
    expect(unstoredPushChannels()).toEqual([CHANNEL_ID]);

    logSeq = '8';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(unstoredPushChannels()).toEqual([]);
  });
T
print;
