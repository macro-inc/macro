undef $/; $_=<STDIN>;
s/(    const distanceFromTop = logicalScrollOffset\(scrollTop\);\n)/$1    console.log('DBGl state', Math.round(performance.now()), 'top', Math.round(scrollTop), 'vo', Math.round(virtualizer.scrollOffset ?? -1), 'n', props.keys().length, 'scrolling', virtualizer.isScrolling, 'total', Math.round(virtualizer.getTotalSize()));\n/ or die 1;
s/(      nearTopKey = props\.keys\(\)\[0\];\n      props\.onScrollNearTop\?\.\(\);\n)/      console.log('DBGl FIRE', Math.round(performance.now()));\n$1/ or die 2;
s/(  const getItemKey = createMemo\(\(\) => \{\n    const keys = \[\.\.\.props\.keys\(\)\];\n)/$1    console.log('DBGl keys', Math.round(performance.now()), keys.length, 'top', Math.round(scrollRef?.scrollTop ?? -1));\n/ or die 3;
print;
