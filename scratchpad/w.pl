undef $/; $_=<STDIN>;
s/(  const settlements = watchSettlements\(host\);\n  try \{\n)/$1    console.log('DBGq write-start', Math.round(performance.now()));\n/ or die 1;
s/(    const disposition = optimisticMutationDispositionOf\(result\);\n)/$1    console.log('DBGq write-answer ' + (disposition?.kind ?? 'direct'), Math.round(performance.now()));\n/ or die 2;
s/(        await settlements\.committed\(disposition\.transactionId\);\n)/$1        console.log('DBGq write-committed', Math.round(performance.now()));\n/ or die 3;
print;
