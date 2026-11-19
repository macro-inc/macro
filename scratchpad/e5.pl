undef $/; $_ = <STDIN>;
s#so a device page or thread read while one is outstanding is read again once `pushesStored` \(`catch-up.ts`\) resolves \(at most two seconds later\);#so a device page older than a push on screen, or a thread read while one is outstanding, waits for `pushesStored` (`catch-up.ts`) and is read again, at most three times; a push the device has not taken within two seconds is not waited on further and the read is shown as it is;# or die "a";
print;
