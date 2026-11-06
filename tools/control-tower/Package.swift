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
        .target(name: "TowerCore", resources: [.copy("Resources")]),
        .executableTarget(name: "tower-cli", dependencies: ["TowerCore"]),
        .executableTarget(name: "TowerApp", dependencies: ["TowerCore"]),
        .testTarget(name: "TowerCoreTests", dependencies: ["TowerCore"], exclude: ["Fixtures"]),
        .testTarget(name: "TowerAppTests", dependencies: ["TowerApp", "TowerCore"]),
    ]
)
