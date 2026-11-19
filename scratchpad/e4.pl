undef $/; $_ = <STDIN>;
s#(  it\('leaves the read to REST when the device stops serving it')#  it('stops when the read is cancelled during the wait', async () => {
    const controller = new AbortController();
    mocks.loadChannelPage.mockResolvedValue(devicePage('older', '7'));
    mocks.pushesStored.mockImplementation(async () => {
      controller.abort();
      return true;
    });

    await expect(
      loadLocalChannelTimelinePage({ ...read, signal: controller.signal })
    ).rejects.toThrow();
    expect(mocks.loadChannelPage).toHaveBeenCalledTimes(1);
  });

$1# or die "a";
print;
