undef $/; $_=<STDIN>;
s/(    return loaded\.page;\n  \} catch \(error\) \{\n    reportFallback)/    console.log('DBGpage', read.channelId.slice(0, 6), loaded.source, anchored ? 'anchored' : 'latest', caughtUp, loaded.page.entries.length, JSON.stringify(loaded.page.entries.slice(0, 2).map((e) => (e.type === 'activity' ? 'act' : e.message.content.slice(0, 16)))));\n$1/ or die 1;
s/(    return loaded\?\.thread;\n)/    console.log('DBGthread', loaded?.source, loaded?.thread.replies.length);\n$1/ or die 2;
s/(  if \(!host \|\| !channelCacheAnswered\(host\)\) return undefined;\n  try \{\n    let loaded = await loadChannelThread)/  console.log('DBGthread-start', !!host, !!host \&\& channelCacheAnswered(host));\n$1/ or die 3;
s/(  \} catch \(error\) \{\n    reportDeviceFault\(error\);\n    return undefined;\n  \}\n\}\n\n\/\*\*\n \* Where a message sits)/  } catch (error) {\n    console.log('DBGthread-error', String(error).slice(0, 120));\n    reportDeviceFault(error);\n    return undefined;\n  }\n}\n\n\/**\n * Where a message sits/ or die 4;
print;
