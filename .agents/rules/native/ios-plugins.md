---
description: "iOS Tauri plugins create UIKit views and gesture recognizers in load(webview:), never in an initializer."
paths:
  - "apps/web/tauri/*/ios/**/*.swift"
globs: "apps/web/tauri/*/ios/**/*.swift"
alwaysApply: false
---

# Create UIKit objects in `load(webview:)`, not in a plugin initializer

Tauri constructs iOS plugins in `Builder::build`, before `run()` enters
`UIApplicationMain`. UIKit registers a gesture recognizer with the running
application when it is added to a view, so a recognizer created earlier (including
the built-in ones of a `UIScrollView`) keeps a nil delayed-touch dispatcher, and
UIKit aborts with `-[__NSArrayM insertObject:atIndex:]: object cannot be nil` in
`-[UIGestureRecognizer _delayTouchesForEvent:inPhase:]` the first time it delays a
touch. This crashed the native call drawer on every touch of its participant row.

- Build views, view controllers, and anything that owns them in `load(webview:)`
  or later, as `CallKitPlugin` does with `CallVideoOverlayController`.
- Don't initialize such objects in stored-property defaults or `init` of a
  `Plugin` subclass. Test harnesses that build UIKit objects after launch cannot
  catch this.

Check: no stored property or initializer of a `Plugin` subclass constructs a
`UIView`, `UIViewController`, `UIGestureRecognizer`, or a type that creates them.
