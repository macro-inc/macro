undef $/; $_=<STDIN>;
s/(- `crates\/messages\/proofs`)/  - A push was stored a quarter second after it was shown even in a quiet
    channel, and a push the change log did not hold yet when asked was
    not asked for again. A quiet channel's push is stored at once, and
    the log is asked again, a second apart and at most five times.
  - Scrolling back through history offline could land in the middle of
    it. The lookup of an unread thread's root fails offline, and
    `queryReadyGate` suspended on that failed query each time an older
    page gave it new options, which detached the channel and reset its
    scroll position. The gate no longer reads a query that failed
    without data.
$1/ or die 1;
s/- Scrolling back through history offline can lose the reader's place\n  when the device answers two older pages in quick succession\.\n// or die 2;
s/(- The first send after a page opens reaches the server one to two\n  seconds after it is written; later sends take well under a second\.\n)/$1  The queue waits up to two seconds for the email draft store to open\n  before its first delivery.\n- A push is stored on the device 0.1 to 0.2 s after it is shown when the\n  cache is idle, and one to six seconds after while the cache is busy\n  (the first half minute of a page); a reload inside that time, followed\n  by opening offline, shows the channel without that message until the\n  next connection.\n/ or die 3;
print;
