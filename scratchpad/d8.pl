undef $/; $_=<STDIN>;
s/(    const from = await storedSeq\(host, channelId\);\n)/    console.log('DBGrun start', channelId.slice(0, 6));\n$1    console.log('DBGrun from', channelId.slice(0, 6), from);\n/ or die 1;
s/(      const delta = await fetchChanges\(channelId, after\);\n)/$1      console.log('DBGrun delta', channelId.slice(0, 6), after, delta.seq, delta.messages.length, delta.hasMore, delta.resetRequired);\n/ or die 2;
s/(        const committed = await host\.channelTimelineCommit\(\{\n          channelId,\n          removedKeys)/        console.log('DBGrun committing');\n$1/ or die 3;
s/(        if \(committed\.kind !== 'committed'\) break;)/        console.log('DBGrun committed', JSON.stringify(committed).slice(0, 100));\n$1/ or die 4;
print;
