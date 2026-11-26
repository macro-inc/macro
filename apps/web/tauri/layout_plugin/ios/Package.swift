// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "tauri-plugin-layout",
    platforms: [.iOS(.v15)],
    products: [.library(name: "tauri-plugin-layout", type: .static, targets: ["tauri-plugin-layout"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-layout", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
