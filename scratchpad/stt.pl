undef $/; $_=<STDIN>;
s/  catchUpAndRefresh: vi\.fn\(async \(\) => \{\}\),\n\}\)\);/  catchUpAndRefresh: vi.fn(async () => {}),\n  channelCacheAnswered: vi.fn(() => true),\n}));/ or die 1;
s/  channelCacheAnswered: \(\) => true,/  channelCacheAnswered: mocks.channelCacheAnswered,/ or die 2;
s/(  mocks\.catchUpAndRefresh\.mockResolvedValue\(undefined\);\n)/$1  mocks.channelCacheAnswered.mockReturnValue(true);\n/ or die 3;
my $t = <<'T';

  it('leaves a thread to REST while the host starts, and has the device hold it too', async () => {
    mocks.channelCacheAnswered.mockReturnValue(false);
    mocks.loadChannelThread.mockResolvedValue({
      thread: thread('server'),
      source: 'server',
    });

    expect(await loadLocalChannelThread(CHANNEL_ID, 'root')).toBeUndefined();
    expect(mocks.loadChannelThread).toHaveBeenCalledExactlyOnceWith(
      host,
      CHANNEL_ID,
      'root'
    );
  });
T
s/(    expect\(mocks\.pushesStored\)\.not\.toHaveBeenCalled\(\);\n  \}\);\n)(\}\);\n*)$/$1$t$2/ or die 4;
print;
