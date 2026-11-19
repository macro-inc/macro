undef $/; $_=<STDIN>;
s/\/\*\* How long until the log is asked again for a push it did not have yet\. \*\/\nconst PUSH_RETRY_MS = 1_000;\nconst MAX_PUSH_RETRIES = 5;\n// or die 1;
s/  \/\*\* Times in a row the log was asked and did not have every push\. \*\/\n  retries: number;\n// or die 2;
s/state = \{ pushed: new Set\(\), retries: 0 \};/state = { pushed: new Set() };/ or die 3;
s/  let asked = false;\n  try \{\n    await catchUpAndRefresh\(host, channelId\);\n    asked = true;\n  \} finally \{\n    \/\/ A push noted during the run has its own wait\.\n    if \(state\.storing === storing\) state\.storing = undefined;\n    storing\.done\(\);\n.*?\n  \}\n\}\n/  try {\n    await catchUpAndRefresh(host, channelId);\n  } finally {\n    \/\/ A push noted during the run has its own wait.\n    if (state.storing === storing) state.storing = undefined;\n    storing.done();\n  }\n}\n/s or die 4;
print;
