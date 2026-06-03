// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-call-kit",
  platforms: [
    .macOS(.v11),
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
    .package(name: "Tauri", path: "../.tauri/tauri-api"),
    .package(url: "https://github.com/livekit/client-sdk-swift.git", exact: "2.13.0"),
    .package(url: "https://github.com/livekit/webrtc-xcframework.git", exact: "144.7559.03"),
  ],
  targets: [
    .target(
      name: "tauri-plugin-call-kit",
      dependencies: [
        .byName(name: "Tauri"),
        .product(name: "LiveKit", package: "client-sdk-swift"),
        .product(name: "LiveKitWebRTC", package: "webrtc-xcframework"),
      ],
      path: "Sources"
    )
  ]
)
