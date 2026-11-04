// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PendingPushStore",
    products: [.library(name: "PendingPushStore", targets: ["PendingPushStore"])],
    targets: [
        .target(name: "PendingPushStore"),
        .testTarget(name: "PendingPushStoreTests", dependencies: ["PendingPushStore"]),
    ]
)
