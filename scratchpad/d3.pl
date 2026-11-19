undef $/; $_=<STDIN>;
s/(export function refreshChannelViews\(channelId: string\): void \{\n)/$1  console.log('DBGrefresh');\n/ or die 3;
s/(  let outcome = await catchUpChannel\(host, channelId, fetchChanges\);\n  let refresh = false;\n)/$1  console.log('DBGcatchup', JSON.stringify(outcome), JSON.stringify([...state.pushed]));\n/ or die 4;
print;
