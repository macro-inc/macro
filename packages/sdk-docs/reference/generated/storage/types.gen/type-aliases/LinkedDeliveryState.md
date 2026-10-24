# Type Alias: LinkedDeliveryState

> **LinkedDeliveryState** = `"pending"` \| `"sending"` \| `"unknown"` \| `"accepted"` \| `"sent"` \| `"delivered"` \| `"read"` \| `"failed"`

Observed send state. `unknown` means the request may have reached WhatsApp;
it is never sent again automatically.
