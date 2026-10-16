# Type Alias: GuestId

> **GuestId** = `string`

A non-account guest of a single call session.

The id doubles as the guest's RTC participant identity, so identities are
opaque UUIDs and never share a namespace (or a column) with Macro user
ids. Only the server mints them; Macro users keep `macro|…` identities,
so an RTC identity classifies as exactly one of the two.
