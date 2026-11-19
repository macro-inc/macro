undef $/; $_=<STDIN>;
my $t = "Math.round(performance.now())";
s/(    const from = await storedSeq\(host, channelId\);\n)/    console.log('DBGc run-start', $t);\n$1    console.log('DBGc storedSeq', $t, from);\n/ or die 1;
s/(      const delta = await fetchChanges\(channelId, after\);\n)/      console.log('DBGc fetch-start', $t, after);\n$1      console.log('DBGc fetched', $t, delta.seq, delta.messages.length, delta.hasMore);\n/ or die 2;
s/(        if \(committed\.kind !== 'committed'\) break;\n)/        console.log('DBGc committed', $t, committed.kind);\n$1/ or die 3;
s/(  state\.pushed\.add\(String\(seq\)\);\n)/$1  console.log('DBGc push', $t, String(seq), 'storing', !!state.storing, 'timer', state.timer !== undefined);\n/ or die 4;
s/(  if \(state\.pushed\.size === 0\) forgetUnstoredPush\(channelId\);\n)/  console.log('DBGc done', $t, outcome.kind, 'left', state.pushed.size);\n$1/ or die 5;
print;
