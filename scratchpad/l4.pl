undef $/; $_=<STDIN>;
s/(    let dbgConnected = scrollRef\?\.isConnected;\n)/$1    const dbgUnsub = queryClient.getQueryCache().subscribe((event) => {\n      if (event.type === 'added' || (event.type === 'updated' && event.action.type === 'fetch') || event.type === 'observerAdded')\n        console.log('DBGl query', Math.round(performance.now()), event.type, event.query.state.status, event.query.state.fetchStatus, JSON.stringify(event.query.queryKey).slice(0, 160));\n    });\n    onCleanup(dbgUnsub);\n/ or die 1;
s/^(import )/import { queryClient } from '\@queries\/client';\n$1/ or die 2;
print;
