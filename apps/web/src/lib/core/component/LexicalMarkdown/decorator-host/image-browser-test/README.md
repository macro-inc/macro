# Image decorator parity

The fixture loads the real Source and native editor surfaces from the same
Source export. It compares literal model JSON, editor markup and shadow
markup. It also checks selection, cached setters, Portal lifetime and toolbar removal.
The browser intercepts only the synthetic image response and unrelated app
service requests.

Run the three Playwright projects with the matching generated native package
under `wasm/`. The config verifies the sealed manifest and every package file.
Use `IMAGE_SOURCE_ONLY=1` for the Source preimage capture and keep those raw
captures for comparison against the Source host change. The test records the
compiled Source dependency witnesses alongside each raw capture.

The 50ce paired trace covers a remote URL and leaves upload IO inactive. It
precedes the native DSS admission guard. DSS and upload completion require
matching native and IO coverage.

The image host observes upload events from the surface's IO owner. A stored
local URL alone does not signal an in-flight upload.
