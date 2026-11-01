// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ControlTower",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TowerCore", targets: ["TowerCore"]),
    ],
    targets: [
        .target(name: "TowerCore"),
        .testTarget(name: "TowerCoreTests", dependencies: ["TowerCore"]),
    ]
)
