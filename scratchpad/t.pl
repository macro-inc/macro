undef $/; $_=<STDIN>;
s/  it\('asks the log again for a push it did not have yet'.*?\n  \}\);\n\n//s or die 1;
s/const \{ invalidateQueries, channelCacheHost, fetchCached \} = vi\.hoisted\(\(\) => \(\{\n  invalidateQueries: vi\.fn\(\),\n  channelCacheHost: vi\.fn\(\),\n  fetchCached: vi\.fn\(\),\n\}\)\);\nvi\.mock\('\.\.\/\.\.\/\.\.\/calendar\/graphql\/network', \(\) => \(\{ fetchCached \}\)\);\n/const { invalidateQueries, channelCacheHost } = vi.hoisted(() => ({\n  invalidateQueries: vi.fn(),\n  channelCacheHost: vi.fn(),\n}));\n/ or die 2;
print;
