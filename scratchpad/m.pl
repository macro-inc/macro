undef $/; $_ = <STDIN>;
s{          applyMessage\(data, 'posted'\);}{          if (variables.parent.type === 'channel' && channelCacheHost()) {
            applyQueuedWrite(data, 'posted');
          } else {
            applyMessage(data, 'posted');
          }} or die "a";
s{        onSuccess\(data\) \{\n          applyMessage\(data, 'edited'\);}{        onSuccess(data, vars) {
          if (vars.parent.type === 'channel' && channelCacheHost()) {
            applyQueuedWrite(data, 'edited');
          } else {
            applyMessage(data, 'edited');
          }} or die "b";
s{import \{ applyMessage, applyRootDeletion, applyThreadState \} from './sync';}{import {
  applyMessage,
  applyQueuedWrite,
  applyRootDeletion,
  applyThreadState,
} from './sync';} or die "c";
print;
