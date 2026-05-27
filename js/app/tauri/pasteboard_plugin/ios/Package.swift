// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-pasteboard",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-pasteboard",
      type: .static,
      targets: ["tauri-plugin-pasteboard"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-pasteboard",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources"
    )
  ]
)
