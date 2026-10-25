// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-notifications",
    platforms: [.iOS(.v15)],
    products: [.library(name: "tauri-plugin-notifications", type: .static, targets: ["tauri-plugin-notifications"])],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        .package(path: "../store"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-notifications",
            dependencies: [.byName(name: "Tauri"), .product(name: "PendingPushStore", package: "store")],
            path: "Sources"
        ),
    ]
)
