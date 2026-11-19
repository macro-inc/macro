undef $/; $_=<STDIN>;
s/const \{ invalidateQueries, channelCacheHost \} = vi\.hoisted\(\(\) => \(\{\n  invalidateQueries: vi\.fn\(\),\n  channelCacheHost: vi\.fn\(\),\n\}\)\);/const { invalidateQueries, channelCacheHost, fetchCached } = vi.hoisted(() => ({\n  invalidateQueries: vi.fn(),\n  channelCacheHost: vi.fn(),\n  fetchCached: vi.fn(),\n}));\nvi.mock('..\/..\/..\/calendar\/graphql\/network', () => ({ fetchCached }));/ or die 1;
my $t = <<'T';
  it('asks the log again for a push it did not have yet', async () => {
    vi.useFakeTimers();
    channelCacheHost.mockReturnValue(sequencedHost('7'));
    fetchCached.mockResolvedValue({ user: { channelChanges: changes() } });

    noteChannelPush(CHANNEL_ID, 8);
    await vi.advanceTimersByTimeAsync(0);
    expect(unstoredPushChannels()).toEqual([CHANNEL_ID]);

    fetchCached.mockResolvedValue({
      user: { channelChanges: changes({ seq: '8' }) },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(unstoredPushChannels()).toEqual([]);
  });

T
s/(  it\('catches up what the page before left noted, and keeps what fails')/$t$1/ or die 2;
print;
