# iOS layout bridge

This plugin projects the current WKWebView's UIKit traits into root HTML
attributes. It has no app-data or network access and exposes no commands.

- `ios/Sources/NativeLayoutObserver.swift` observes layout and trait changes.
- `data-native-navigation-edge` is a physical `left`, `right`, or `bottom` edge.
- `data-native-horizontal-size-class` keeps JS and the `mobile:` CSS variant
  aligned with UIKit's compact/regular width, including Duo and Split View.
- Request current values after every document load. Never infer Duo from its
  model name, a screen dimension, `UIScreen.main`, or interface orientation.
- Older native binaries omit the attributes and retain the existing responsive
  dock. This optional bridge requires a native release to enable Duo adaptation,
  but does not add a required command to the OTA contract.
- Keyboard frame changes complete the existing show/hide bridge using the
  current webview's bottom-edge intersection. A floating or off-window keyboard
  must not reserve the full screen-space keyboard frame height.

## Checks

- Compile with Xcode 27.1; guard new APIs with availability checks for iOS 15+.
- Exercise closed, open, rotated, partially folded, and both Split View sides
  on the Duo simulator. Check a conventional iPhone as well.
- Keep navigation order, unread state, More, search focus, and keyboard access
  intact while resizing. Check independent safe areas on all four edges.
- Run the mobile component tests and `just check` from the repository root.
