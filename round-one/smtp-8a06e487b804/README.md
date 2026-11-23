# SMTP lifetime runtime proof

Source: `8a06e487b804c2db9f67af8666f295abcc082de0` (SMTP fix `d619e2e13ca`).
[Runtime summary](runtime.json), SHA-256 `c7914ce796e6a307b405f01c397351786e60e342005717ae3c609cd6622581ff`.

Actual running IMAP service, email API and email worker hashes match their clean source build. Direct authenticated private HTTP draft creation and Submit use the real local IMAP/SMTP adapters. Two distinct synthetic messages each receive one Submit call and one capture in the local SMTP sink. The measured trace links `execute` to `imap.submit` to `imap.protocol.submit` (21 spans); the protocol deadline flag is false. Trace and message identifiers are withheld.

The renewal count is zero after private collector normalization of bounded decimal strings. The application's unsigned counters use the exporter's debug-string representation; production numeric aggregation is **not verified** and is tracked by `mac-imap-smtp.105`. Malformed counts, invalid booleans and disallowed data are removed; linked canary spans are dropped. The first probe exposed the earlier filter gap and is not counter proof.

HTTP cancellation, renewal failures/timeouts, total-deadline expiry and shutdown refusal/draining are covered by native regressions, **not exercised at runtime here**. Support services and the frontend retain older builds; no current UI, public-gateway or real-provider proof is claimed. Local SMTP acceptance/capture is not real recipient delivery. Multi-replica throughput and human playback remain unverified.

Preview applications were stopped after this bounded check, with persistent local data kept. Other round-one items remain open. **HOLD MERGE; no deploy.**
