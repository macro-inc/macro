undef $/; $_=<STDIN>;
s/(vi\.mock\('\.\.\/\.\.\/client', \(\) => \(\{)/const { channelCacheHost } = vi.hoisted(() => ({\n  channelCacheHost: vi.fn(),\n}));\nvi.mock('..\/local\/flag', async (importOriginal) => ({\n  ...(await importOriginal<typeof import('..\/local\/flag')>()),\n  channelCacheHost,\n}));\n$1/ or die 1;
s/  it\("moves another window's waiting message when its delivery is pushed", \(\) => \{\n/  it.runIf(parent.type === 'channel')("moves another window's waiting message when its delivery is pushed", () => {\n    channelCacheHost.mockReturnValue({});\n/ or die 2;
s/(    expect\(shown\(\)\)\.toEqual\(\['waiting', 'theirs', 'root'\]\);\n)/$1    channelCacheHost.mockReset();\n/ or die 3;
print;
