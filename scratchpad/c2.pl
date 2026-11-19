undef $/; $_=<STDIN>;
s/  for \(const channelId of unstoredPushChannels\(\)\) \{\n    await catchUpAndRefresh\(host, channelId, fetchChanges\);\n  \}/  for (const channelId of unstoredPushChannels()) {\n    try {\n      await catchUpAndRefresh(host, channelId, fetchChanges);\n    } catch {\n      \/\/ Offline or a failed request: it stays noted for the next try.\n    }\n  }/ or die 1;
print;
