# Publication acknowledgement driver

`PublicationHoldDriver` accepts a required generated disposition and an actual
local acknowledgement callback. Capture the received disposition for diagnosis,
then acknowledge the local publication/no-op/discard, including bindings, leases
and listeners, before releasing a deferred ticket. `None` makes no native call.
The host supplies fresh clocks, the actual synchronous executor/native release,
flag consumption, publication acknowledgement and typed error recovery.

Failed or partial local acknowledgement, unknown native transport results, and
partial flag consumption are fatal/blocked. The driver never reruns those steps
or infers rollback from a missing result. Only a known release reply whose flags
were consumed can enter resumable publication draining. Its required drain port
must retain actual decoded receipts and advance their acknowledgement cursor
only on success; `resume` retries only that unfinished port work. It must not
reapply previously acknowledged receipts or repeat native release.

Drain every actual release publication before recovering a deferred native/host
failure. Preserve opaque thrown values, including undefined/null. Such a failure
remains blocked after draining. Closed and CompositionHeld both close the JS
stage association; composition retains its own native authority, with no retry
spin. There is no missing-disposition default and no implicit editor, finalizer,
clock, executor or model in this module.

Component tests use the real generated unions and explicit port effects to
verify acknowledgement order and error identity. They do not establish actual
native transport, full backend wiring, hosted callbacks or Macro acceptance.
