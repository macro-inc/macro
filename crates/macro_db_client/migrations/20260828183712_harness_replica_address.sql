-- Where to forward a session's commands when another replica manages it:
-- the replica's own private base URL, written with its heartbeat. Nullable
-- because a replica row can be created by a claim before the first
-- heartbeat carries the address, and because a local single-replica stack
-- has no routable address to publish - a peer that reads NULL treats the
-- manager as unreachable rather than guessing.
ALTER TABLE harness_replica
    ADD COLUMN address TEXT;
