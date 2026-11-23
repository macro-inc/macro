# IMAP/SMTP proof for #11484

Latest round-one checkpoint `7d3b89c17dd`: [non-FIFO mailbox claim measurements](round-one/nonfifo-7d3b89c17dd/README.md). Earlier: [projection queue measurements](round-one/projection-166462eea37/README.md) at `166462eea37`, and [provider repair measurements](round-one/provider-647b23e2aae/README.md) at `647b23e2aae`, superseded because `7d3b89c17dd` removes that repair job. Other round-one fixes remain open; no new movie or real-provider proof is claimed.

Previous runtime checkpoint `f0740021328`: [main-merge runtime checks](merge-f4bd312fc30/README.md), on `f4bd312fc30` plus one test-only commit.

[Desktop and phone proof recorded at f678c962e57](f678c962e57/README.md), plus the connect clip and smoke at `76dda9df8e3`, source provenance, final-head comparison, stand-ins and scope gaps.

## Historical partial proof

Partial real-stack proof at `750eec99d0fc1c9900cfb0e91461e3a63f11b39e` (2026-11-21).

[Play/download the MP4](750eec99d0f/imap-smtp-lab-partial-750.mp4) (165 seconds, H.264; no GIF).

The real UI shows wrong password then successful retry, first sync and a new arrival without reload, one SMTP acceptance with an IMAP Sent copy, Connect another account, a reply round trip in one thread, and restart without duplicate mail or another SMTP submission. The ordinary send has a visible wait of about a minute; this recording is not a latency claim.

Dovecot and Mailpit are local stand-ins. Passwordless sign-in uses local test authentication. Captured MIME is appended unchanged into the synthetic recipient INBOX to simulate delivery. SMTP acceptance is not recipient delivery. No real mailbox was recorded. The private address bar is masked.

**Known gap:** forced refusal is stuck at this head after a pre-DATA failure on a stale pooled SMTP connection. The latest proof above shows the fixed refusal path. This recording does not validate later fixes, real-provider delivery, phone/notch layouts, or dark mode.

Screenshots show before connection, pending first sync, first import, new arrival, ordinary send, threaded reply, and recovery. These are workflow before/after images from the same tested head, not main-versus-PR comparison screenshots. See [manifest](750eec99d0f/manifest.json).
