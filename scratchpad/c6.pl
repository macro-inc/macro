undef $/; $_ = <STDIN>;
s#(export function noteChannelPush\(channelId: string, seq: number \| string\): void \{\n)#$1  forgetPendingChannelPages(channelId);\n# or die "a";
s#(import \{ channelCacheHost \} from '\./flag';\n)#$1import { forgetPendingChannelPages } from './pages';\n# or die "b";
print;
