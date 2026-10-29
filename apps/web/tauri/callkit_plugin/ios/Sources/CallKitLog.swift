import Foundation
import os

private let callKitLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.macro.app", category: "CallKit")

/// Writes a `[CallKit]` line to the unified log. `print` output is discarded on
/// a device without an attached debugger; `.default` (notice) and `.error`
/// entries persist in the device log and appear in sysdiagnose and
/// `log collect`. The message is logged as public, so it must never contain
/// personal data: no participant identities (`macro|<email>`), display names,
/// channel titles, or device names. Use LiveKit SIDs and opaque ids instead.
func callKitLog(_ message: String, level: OSLogType = .default) {
    callKitLogger.log(level: level, "[CallKit] \(message, privacy: .public)")
}
