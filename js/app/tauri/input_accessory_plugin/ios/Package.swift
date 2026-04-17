// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-input-accessory",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-input-accessory",
      type: .static,
      targets: ["tauri-plugin-input-accessory"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-input-accessory",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources"
    )
  ]
)
