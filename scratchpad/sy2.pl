undef $/; $_=<STDIN>;
s/(      insertMessageIntoTargetCaches\(parent, target, item\);\n)/$1      \/\/ With the device queue a person's own message can wait above this one\n      \/\/ with a later time, or the server can have placed this one earlier.\n      if (parent.type === 'channel' && channelCacheHost()) {\n        setMessageTimelineData(parent, (data) =>\n          placeTopLevelMessageInMessageTimeline(data, message.id)\n        );\n      }\n/ or die 1;
s/(import \{ noteChannelPush \} from '\.\/local\/catch-up';\n)/$1import { channelCacheHost } from '.\/local\/flag';\n/ or die 2;
print;
