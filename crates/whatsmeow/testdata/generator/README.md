# Test vector generators

Go code that runs whatsmeow's own code at the pinned revision
(`b2b1e71d45e2ff171153b025b5a42f475bb30ef8`) and writes the expected values
the Rust tests compare against. Test tooling only: not built in CI, and it
never contacts WhatsApp.

## Programs (`media`, `appstate`)

Each is its own `package main` directory in this Go module. `go.mod` requires
whatsmeow at the pinned revision as a pseudo-version, so Go fetches it from
the module proxy; to use a local checkout instead, run `go mod edit -replace
go.mau.fi/whatsmeow=/path/to/whatsmeow` (don't commit the replace). They
reach unexported whatsmeow functions with `go:linkname`, which the linker only
allows with `-checklinkname=0`. Run from this directory:

| Generator | Command | Writes |
| --- | --- | --- |
| `media` | `go run -ldflags=-checklinkname=0 ./media` | `../media/vectors.json` |
| `appstate` | `go run -ldflags=-checklinkname=0 ./appstate` | `../appstate/vectors.json` |

`media` runs a real `Client` against local TLS test servers. Its vectors
change on every run (Go's `Upload` picks a random media key), and so does one
`appstate` patch (`EncodePatch` uses random IVs); the assertions don't.

## In-package tests (`inpackage`)

Most client code is unexported methods on `*Client`, so these generators are
`_test.go` files in `package whatsmeow`. `inpackage/generate.sh [checkout]`
copies them into a whatsmeow checkout at the pinned revision (cloning one if
no path is given), runs `go test -run TestGenerate`, and writes
`../*.json`, which the Rust tests read through `src/vectors.rs`.
