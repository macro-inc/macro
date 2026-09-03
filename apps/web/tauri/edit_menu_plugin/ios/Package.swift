// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-edit-menu",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-edit-menu",
      type: .static,
      targets: ["tauri-plugin-edit-menu"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-edit-menu",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources"
    )
  ]
)
