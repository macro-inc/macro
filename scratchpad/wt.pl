undef $/; $_=<STDIN>;
s/(afterEach\(\(\) => \{\n  pageIsLeaving\.mockReturnValue\(false\);\n)/const { announceWaitingWrite } = vi.hoisted(() => ({\n  announceWaitingWrite: vi.fn(),\n}));\nvi.mock('..\/waiting-writes', () => ({ announceWaitingWrite }));\n$1  announceWaitingWrite.mockClear();\n  onlineManager.setOnline(true);\n/ or die 1;
my $t = <<'T';
  it("tells the device's other windows of a write held while offline only", async () => {
    const { client } = fakeClient(() => ({
      disposition: { kind: 'queued', transactionId: '4' },
    }));
    const { host, settle } = writeHost([graphqlMessage(7)]);
    const send = () => {
      const sending = sendChannelMessage(
        host,
        {
          channelId: CHANNEL_ID,
          id: graphqlMessage(7).id,
          senderId: SENDER,
          message: { content: 'hello' },
        },
        { client }
      );
      return sending;
    };

    const online = send();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(announceWaitingWrite).not.toHaveBeenCalled();
    settle({ transactionId: '4', status: 'committed' });
    await online;

    onlineManager.setOnline(false);
    const offline = send();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(announceWaitingWrite).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID);
    settle({ transactionId: '4', status: 'committed' });
    await offline;
  });

T
s/(  it\('answers with the row it sent when a delivered send cannot be read back')/$t$1/ or die 2;
s/(import \{\n  type Client,)/import { onlineManager } from '\@tanstack\/solid-query';\n$1/ or die 3;
print;
