import Foundation
import Tauri
import WebKit

private struct SetDeviceArgs: Decodable {
    let deviceId: String
    let token: String
    let reportUrl: String
}

private struct SyncArgs: Decodable {
    let fences: [Fence]
}

/// JS bridge for `plugin:geofence|<command>`. Tauri calls commands on its IPC
/// queue; every one hops to the main thread, which owns the monitor and store.
final class GeofencePlugin: Plugin, @unchecked Sendable {
    /// Tauri constructs plugins before `UIApplicationMain`, so the location
    /// manager and lifecycle observers start here rather than in `init`.
    override public func load(webview: WKWebView) {
        GeofenceMonitor.shared.start()
    }

    @objc public func status(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let payload: JsonObject = [
                "permission": GeofenceMonitor.shared.permission().rawValue,
                "device": GeofenceStore.device() != nil,
            ]
            invoke.resolve(payload)
        }
    }

    @objc public func requestPermission(_ invoke: Invoke) {
        DispatchQueue.main.async {
            GeofenceMonitor.shared.requestPermission(invoke)
        }
    }

    @objc public func setDevice(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetDeviceArgs.self)
        guard
            let reportUrl = URL(string: args.reportUrl),
            reportUrl.scheme == "https" || reportUrl.scheme == "http",
            reportUrl.host != nil
        else {
            invoke.reject("reportUrl must be an absolute http(s) URL")
            return
        }

        let device = GeofenceDevice(deviceId: args.deviceId, token: args.token, reportUrl: reportUrl)
        DispatchQueue.main.async {
            guard GeofenceStore.setDevice(device) else {
                invoke.reject("Failed to store the device token in the Keychain")
                return
            }
            GeofenceMonitor.shared.sync(GeofenceStore.fences())
            invoke.resolve()
        }
    }

    @objc public func deviceId(_ invoke: Invoke) {
        DispatchQueue.main.async {
            let deviceId: Any = GeofenceStore.deviceId() ?? NSNull()
            let payload: JsonObject = ["deviceId": deviceId]
            invoke.resolve(payload)
        }
    }

    @objc public func sync(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SyncArgs.self)
        DispatchQueue.main.async {
            GeofenceMonitor.shared.sync(args.fences)
            invoke.resolve()
        }
    }

    @objc public func clear(_ invoke: Invoke) {
        DispatchQueue.main.async {
            GeofenceMonitor.shared.clear()
            invoke.resolve()
        }
    }
}

@_cdecl("init_plugin_geofence")
public func initPlugin() -> Plugin {
    return GeofencePlugin()
}
