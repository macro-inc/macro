undef $/; $_=<STDIN>;
s/(  let outcome = await catchUpChannel\(host, channelId, fetchChanges\);\n  let refresh = false;\n)/$1  console.log('DBGcatchup', channelId.slice(0, 6), JSON.stringify(outcome), JSON.stringify([...state.pushed]));\n/ or die 4;
s/(  const state = stateOf\(channelId\);\n  state\.pushed\.add\(String\(seq\)\);\n)/$1  console.log('DBGpush', channelId.slice(0, 6), String(seq));\n/ or die 5;
print;
