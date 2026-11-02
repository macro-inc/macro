# Type Alias: WhatsAppAccountState

> **WhatsAppAccountState** = `"pairing"` \| `"connected"` \| `"logged_out"` \| `"disconnected"`

Account lifecycle. Transport outages are not stored: a connected account
stays connected while its session service reconnects.
