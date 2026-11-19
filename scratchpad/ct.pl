undef $/; $_=<STDIN>;
s/(  resetChannelSync,\n)(\} from '\.\.\/catch-up';\n)/$1  storeUnstoredPushes,\n$2import {\n  noteUnstoredPush,\n  resetUnstoredPushes,\n  unstoredPushChannels,\n} from '..\/unstored-pushes';\n/ or die 1;
print;
