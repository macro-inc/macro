# IMAP/SMTP proof for #11484

Partial real-stack proof at `750eec99d0fc1c9900cfb0e91461e3a63f11b39e` (2026-11-21).

[Play/download the MP4](750eec99d0f/imap-smtp-lab-partial-750.mp4) (165 seconds, H.264; no GIF).

The real UI shows wrong password then successful retry, first sync and a new arrival without reload, one SMTP acceptance with an IMAP Sent copy, Connect another account, a reply round trip in one thread, and restart without duplicate mail or another SMTP submission. The ordinary send has a visible wait of about a minute; this recording is not a latency claim.

Dovecot and Mailpit are local stand-ins. Passwordless sign-in uses local test authentication. Captured MIME is appended unchanged into the synthetic recipient INBOX to simulate delivery. SMTP acceptance is not recipient delivery. No real mailbox was recorded. The private address bar is masked.

**Known gap:** forced refusal is stuck at this head after a pre-DATA failure on a stale pooled SMTP connection. Its fix and fresh refusal proof are pending. This recording does not validate newer unpublished fixes, real-provider delivery, phone/notch layouts, or dark mode.

Screenshots show before connection, pending first sync, first import, new arrival, ordinary send, threaded reply, and recovery. These are workflow before/after images from the same tested head, not main-versus-PR comparison screenshots. See [manifest](750eec99d0f/manifest.json).
