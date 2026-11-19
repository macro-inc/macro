undef $/; $_ = <STDIN>;
s#      if \(!\(await pushesStored\(read.channelId, loaded.storedSeq\)\)\) break;\n#      if (!(await pushesStored(read.channelId, loaded.storedSeq))) break;\n      read.signal?.throwIfAborted();\n# or die "a";
print;
