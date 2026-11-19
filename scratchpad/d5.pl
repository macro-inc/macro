undef $/; $_=<STDIN>;
s/(  watchWaitingWrites\(\);\n)/$1  console.log('DBGread start', onlineManager.isOnline(), !!read.revalidate);\n/ or die 1;
s/(        await catchUpChannel\(host, read\.channelId\);\n        caughtUp = true;)/$1\n        console.log('DBGread caughtup');/ or die 2;
s/(    return loaded\.page;\n  \} catch \(error\) \{\n    reportFallback)/    console.log('DBGpage', loaded.source, JSON.stringify(loaded.page.entries.map((e) => (e.type === 'activity' ? 'act' : e.message.content.slice(0, 24)))));\n$1/ or die 3;
print;
