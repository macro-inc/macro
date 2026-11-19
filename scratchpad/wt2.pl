undef $/; $_=<STDIN>;
s/  it\("tells the device's other windows of a write held while offline only".*?\n  \}\);\n\n//s or die 1;
my $t = <<'T';
  it("tells the device's other windows of a write the queue still holds after a moment", async () => {
    vi.useFakeTimers();
    try {
      const { client } = fakeClient(() => ({
        disposition: { kind: 'queued', transactionId: '4' },
      }));
      const { host, settle } = writeHost([graphqlMessage(7)]);
      const send = () =>
        sendChannelMessage(
          host,
          {
            channelId: CHANNEL_ID,
            id: graphqlMessage(7).id,
            senderId: SENDER,
            message: { content: 'hello' },
          },
          { client }
        );

      const delivered = send();
      await vi.advanceTimersByTimeAsync(WAITING_ANNOUNCE_MS - 1);
      settle({ transactionId: '4', status: 'committed' });
      await delivered;
      await vi.advanceTimersByTimeAsync(WAITING_ANNOUNCE_MS);
      expect(announceWaitingWrite).not.toHaveBeenCalled();

      const held = send();
      await vi.advanceTimersByTimeAsync(WAITING_ANNOUNCE_MS);
      expect(announceWaitingWrite).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID);
      settle({ transactionId: '4', status: 'committed' });
      await held;
    } finally {
      vi.useRealTimers();
    }
  });

T
s/(  it\('answers with the row it sent when a delivered send cannot be read back')/$t$1/ or die 2;
s/  onlineManager\.setOnline\(true\);\n// or die 3;
s/import \{ onlineManager \} from '\@tanstack\/solid-query';\n// or die 4;
s/(  sendChannelMessage,\n)(\} from '\.\.\/writes';)/$1  WAITING_ANNOUNCE_MS,\n$2/ or die 5;
print;
