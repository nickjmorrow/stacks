// swift-tools-version:6.0
// Stacks' app logic that doesn't need UIKit: models, API client, local store, sync, session timing.
// Tested on the Mac with `swift test`; the app target links it.

import PackageDescription

let package = Package(
    name: "StacksKit",
    platforms: [.iOS(.v18), .macOS(.v15), .macCatalyst(.v18)],
    products: [.library(name: "StacksKit", targets: ["StacksKit"])],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.11.1"),
    ],
    targets: [
        .target(name: "StacksKit", dependencies: [.product(name: "GRDB", package: "GRDB.swift")]),
        .testTarget(name: "StacksKitTests", dependencies: ["StacksKit"]),
    ]
)
