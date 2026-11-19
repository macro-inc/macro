undef $/; $_=<STDIN>;
s/(    return loaded\.page;\n  \} catch \(error\) \{\n    reportFallback)/    console.log('DBGpage', loaded.source, anchored ? 'anchored' : 'latest', JSON.stringify(loaded.page.entries.map((e) => (e.type === 'activity' ? 'act' : e.message.content.slice(0, 24)))));\n$1/ or die 1;
print;
