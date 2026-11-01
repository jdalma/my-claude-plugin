// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ControlTower",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TowerCore", targets: ["TowerCore"]),
        .executable(name: "tower-cli", targets: ["tower-cli"]),
    ],
    targets: [
        .target(name: "TowerCore"),
        .executableTarget(name: "tower-cli", dependencies: ["TowerCore"]),
        .executableTarget(name: "TowerApp", dependencies: ["TowerCore"]),
        .testTarget(name: "TowerCoreTests", dependencies: ["TowerCore"]),
        .testTarget(name: "TowerAppTests", dependencies: ["TowerApp", "TowerCore"]),
    ]
)
