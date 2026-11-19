undef $/; $_=<STDIN>;
my $L = sub { "console.log('DBGq $_[0]', Math.round(performance.now()));" };
s/(  async function prepare\(\) \{\n)(    const owner = await emailStorageSession\(\);\n)/$1    @{[$L->('p-start')]}\n$2    @{[$L->('p-session')]}\n/ or die 1;
s/(    const before = await localDraftStore\.list\(owner\);\n)(    const queue = await host\.inspectMutations\(\);\n)(    const storageGeneration = await host\.currentStorageGeneration\(\);\n)/$1    @{[$L->('p-list')]}\n$2    @{[$L->('p-inspect')]}\n$3    @{[$L->('p-generation')]}\n/ or die 2;
s/(      if \(!accountKnown\(\)\) return false;\n)/      if (!accountKnown()) { @{[$L->('p-no-account')]} return false; }\n/ or die 3;
print;
