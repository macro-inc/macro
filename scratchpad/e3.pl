undef $/; $_ = <STDIN>;
s#  it\('stops waiting when the device does not take the push', async \(\) => \{(.*?)expect\(await waiting\)\.toBe\(true\);#  it('gives up on a push the device does not take in time', async () => {$1expect(await waiting).toBe(false);#s or die "a";
s#  it\('waits for a push newer than the device page', async \(\) => \{.*?\n  \}\);\n#  it('waits for a push newer than the device page', async () => {
    vi.useFakeTimers();
    channelCacheHost.mockReturnValue(sequencedHost(null));
    noteChannelPush(CHANNEL_ID, 8);

    let stored: boolean | undefined;
    const waiting = (async () => {
      stored = await pushesStored(CHANNEL_ID, '7');
    })();
    await vi.advanceTimersByTimeAsync(100);
    expect(stored).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    await waiting;
    expect(stored).toBe(true);
  });

  it('has a read made again that the device overtook meanwhile', async () => {
    await catchUpAndRefresh(sequencedHost('7'), CHANNEL_ID, async () =>
      changes({ seq: '9', messages: [graphqlMessage(1)] })
    );

    expect(await pushesStored(CHANNEL_ID, '7')).toBe(true);
    expect(await pushesStored(CHANNEL_ID, '9')).toBe(false);
  });
#s or die "b";
print;
