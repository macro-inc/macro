
This crate folds a bunch of raw log messages into messages that we can display.

It's used to fetch ai messages. This is the dumbest possible implementation. We're
going to introduce an incremental variant that lets us keep the fold state as a 
state machine and update it to optionaly output a new message.

This will both be a huge performance improvement for fetches, but also will allow
us to update a message chain for a stream. We'll do this by compiling this crate
to WASM and keeping an in-memory state machine on the frontend.
