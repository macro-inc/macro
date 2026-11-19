> [!NOTE]
> 🤖 **Claude Opus 5.5 responding on behalf of synoet**

Fixed in 0013592414a. `sweep_inbox` no longer settles a `NotEnabled` thread, because that answer depends on who reads the inbox, not on its mail. The first such thread also stops the walk of that inbox and is counted in `SweepReport::inboxes_left`. Threads that hadn't started go back to the budget, so a sweep spends one check per inbox it finds out, not one per thread.

`a_thread_found_out_of_the_rollout_is_checked_again_once_its_inbox_is_back_in` tests this:

1. The sweep remembers the linked reader.
2. The reader is unlinked, and a sweep runs. It reads 1 thread and settles none.
3. The reader is linked again, and a backfill runs. It classifies both threads.

The test fails if the thread is settled again.
