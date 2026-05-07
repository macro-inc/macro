// swift-tools-version:5.3
import PackageDescription

let package = Package(
  name: "tauri-plugin-call-kit",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v14),
  ],
  products: [
    .library(
      name: "tauri-plugin-call-kit",
      type: .static,
      targets: ["tauri-plugin-call-kit"]
    )
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-call-kit",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources"
    )
  ]
)
