undef $/; $_=<STDIN>;
s/(  createEffect\(\(\) => \{\n    const cacheHost = host\(\);\n    if \(!cacheHost \|\| !active\(\) \|\| !isLeader\(\)\) return;\n    pass\(\);)/  createEffect(() => {\n    const cacheHost = host();\n    if (!cacheHost || !active()) return;\n    \/\/ Again after a reconnect: offline, the catch-up fails and stays noted.\n    pass();\n    fireAndForget(storeUnstoredPushes(cacheHost), 'channel-local-sync');\n  });\n\n$1/ or die 1;
s/import \{ resetChannelSync \} from '\.\/catch-up';/import { resetChannelSync, storeUnstoredPushes } from '.\/catch-up';/ or die 2;
s/( \* for thirty days\. Each tab also sends the messages a page that is gone was\n \* still handing to the device queue)/$1, and stores the pushed changes such a\n * page had shown but the device had not taken/ or die 3;
print;
