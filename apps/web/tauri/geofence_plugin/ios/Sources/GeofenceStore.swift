import Foundation
import os
import Security

/// The crossing a fence reports, as the scheduled-action service names it.
enum FenceTransition: String, Codable {
    case arrive
    case leave
}

/// One place a routine names, as the web app passes it to `sync`.
struct Fence: Codable, Equatable {
    let id: String
    let latitude: Double
    let longitude: Double
    let radiusMeters: Double
    let on: FenceTransition
}

/// Device credentials minted by `POST /scheduled-actions/location/devices`.
struct GeofenceDevice: Equatable {
    let deviceId: String
    let token: String
    let reportUrl: URL
}

/// Persists the device and its fences outside the WebView, so a background
/// relaunch can report a crossing before (or without) loading the web app.
/// The token lives in the Keychain; the device id, report URL and fences are
/// not secret and live in UserDefaults. Main thread only.
enum GeofenceStore {
    private static let defaults = UserDefaults.standard
    private static let deviceIdKey = "com.macro.geofence.deviceId"
    private static let reportUrlKey = "com.macro.geofence.reportUrl"
    private static let fencesKey = "com.macro.geofence.fences"
    private static let keychainItem: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.macro.geofence",
        kSecAttrAccount as String: "device-token",
    ]

    static func device() -> GeofenceDevice? {
        guard
            let deviceId = defaults.string(forKey: deviceIdKey),
            let reportUrlString = defaults.string(forKey: reportUrlKey),
            let reportUrl = URL(string: reportUrlString),
            let token = readToken()
        else { return nil }

        return GeofenceDevice(deviceId: deviceId, token: token, reportUrl: reportUrl)
    }

    static func deviceId() -> String? {
        return device()?.deviceId
    }

    static func setDevice(_ device: GeofenceDevice) -> Bool {
        guard writeToken(device.token) else { return false }

        defaults.set(device.deviceId, forKey: deviceIdKey)
        defaults.set(device.reportUrl.absoluteString, forKey: reportUrlKey)
        return true
    }

    /// Keychain items outlive an uninstall but UserDefaults do not: drop a
    /// token left by a previous install, whose device the user can no longer
    /// see or revoke from this install.
    static func dropOrphanedToken() {
        if defaults.string(forKey: deviceIdKey) == nil {
            SecItemDelete(keychainItem as CFDictionary)
        }
    }

    static func fences() -> [Fence] {
        guard let data = defaults.data(forKey: fencesKey) else { return [] }

        do {
            return try JSONDecoder().decode([Fence].self, from: data)
        } catch {
            geofenceLog("Dropping unreadable stored fences: \(error.localizedDescription)", level: .error)
            defaults.removeObject(forKey: fencesKey)
            return []
        }
    }

    static func setFences(_ fences: [Fence]) {
        do {
            defaults.set(try JSONEncoder().encode(fences), forKey: fencesKey)
        } catch {
            geofenceLog("Failed to store fences: \(error.localizedDescription)", level: .error)
        }
    }

    static func removeFence(id: String) {
        setFences(fences().filter { $0.id != id })
    }

    /// Forgets the token, report URL and fences (sign-out or a revoked token).
    static func clear() {
        SecItemDelete(keychainItem as CFDictionary)
        defaults.removeObject(forKey: deviceIdKey)
        defaults.removeObject(forKey: reportUrlKey)
        defaults.removeObject(forKey: fencesKey)
    }

    private static func readToken() -> String? {
        var query = keychainItem
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            if status != errSecItemNotFound {
                geofenceLog("Keychain read failed status=\(status)", level: .error)
            }
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    private static func writeToken(_ token: String) -> Bool {
        SecItemDelete(keychainItem as CFDictionary)

        var item = keychainItem
        item[kSecValueData as String] = Data(token.utf8)
        // Crossings arrive while the phone is locked; after-first-unlock keeps
        // the token readable then, and ThisDeviceOnly keeps it out of backups.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(item as CFDictionary, nil)
        if status != errSecSuccess {
            geofenceLog("Keychain write failed status=\(status)", level: .error)
        }
        return status == errSecSuccess
    }
}
