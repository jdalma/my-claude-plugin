import Foundation
import Testing
@testable import TowerCore

private func members(_ text: String, java: Bool = false) -> [String] {
    scanSource(text, java: java).members.map { m in
        [m.name, m.owner ?? "-", m.receiver ?? "-", m.type ?? "-", m.local ? "local" : "member"].joined(separator: " ")
    }
}

@Test func kotlinMembers() {
    let m = members("""
        package com.example

        val top: Config = Config()
        fun topLevel(a: Int, b: String) = a
        fun <T> List<T>.second(): T = this[1]
        fun Foo?.orEmpty() {}
        class Box(val width: Int, var height: Int, plain: Int) {
            var label = "x"
            fun area(): Int {
                val local = width * height
                listOf(1).map { item -> item + local }
                helper(width)
                return local
            }
            companion object {
                const val MAX = 3
            }
        }
        """)
    #expect(m == [
        "top - - Config member",
        "topLevel - - - member", "a - - Int local", "b - - String local",
        "second - List - member",
        "orEmpty - Foo - member",
        "width com.example.Box - Int member", "height com.example.Box - Int member",
        "label com.example.Box - - member",
        "area com.example.Box - - member",
        "local - - - local",
        "MAX com.example.Box.Companion - - member",
    ])
}

@Test func javaMethodsAndFieldsNotCallsOrLocals() {
    let m = members("""
        package com.example;

        public class Repo<T> extends Base implements Api, Other {
            private final Store store = new Store(load());
            static int count, total;
            List<String> names;
            int[] grid;
            public Repo(Store s) { this.store = s; }
            public <R> List<R> find(String q) throws IOException, Other {
                int local = compute(q);
                return helper(local);
            }
            void find(int id) {}
            @Override public String toString() { return "x"; }
            enum Mode { ON, OFF; void flip() {} }
        }
        """, java: true)
    #expect(m == [
        "store com.example.Repo - Store member",
        "count com.example.Repo - int member",
        "names com.example.Repo - - member",
        "grid com.example.Repo - - member",
        "Repo com.example.Repo - - member",
        "find com.example.Repo - - member",
        "find com.example.Repo - - member",
        "toString com.example.Repo - - member",
        "flip com.example.Repo.Mode - - member",
    ])
}

private let files: [String: String] = [
    "src/app/Main.kt": """
        package com.example.app

        import com.example.model.User
        import com.example.util.format

        fun run(user: User, repo: Repo) {
            val total = 1
            user.save()
            repo.save()
            format(total)
            total.inc()
            Repo.create()
            save()
        }
        fun save() {}
        """,
    "src/app/Repo.kt": """
        package com.example.app

        class Repo {
            fun save() {}
            companion object {
                fun create() = Repo()
            }
        }
        """,
    "src/model/User.kt": "package com.example.model\n\nclass User {\n    fun save() {}\n}\n",
    "src/model/Ext.kt": "package com.example.model\n\nfun User.save(force: Boolean) {}\n",
    "src/util/Format.kt": "package com.example.util\n\nfun format(x: Int) = x\nfun format(x: String) = x\n",
    "src/other/Format.kt": "package com.example.other\n\nfun format(x: Long) = x\n",
    "src/other/Saver.java": "package com.example.other;\n\nclass Saver {\n    void save() {}\n}\n",
]

private func index() -> DeclIndex {
    DeclIndex(files: Dictionary(uniqueKeysWithValues: files.map { ($0.key, scanSource($0.value, java: $0.key.hasSuffix(".java"))) }))
}

private func paths(_ t: CodeTarget) -> [String] {
    switch t {
    case .found(let l): ["\(l.path):\(l.line)"]
    case .many(let c): c.map { "\($0.location.path):\($0.location.line)" }
    case .none: []
    }
}

@Test func memberCandidatesAreRanked() {
    let ix = index()
    let main = "src/app/Main.kt"
    // a bare name declared above in this file: straight there (locals and parameters too)
    #expect(ix.navigate(["total"], in: main, line: 10) == .found(CodeLocation(path: main, line: 7)))
    #expect(ix.navigate(["user"], in: main, line: 8) == .found(CodeLocation(path: main, line: 6)))
    // `user.save()`: `user` is a User, so User.save and the extension on User come first
    #expect(paths(ix.navigate(["user", "save"], in: main, line: 8)) == [
        "src/model/Ext.kt:3", "src/model/User.kt:4",  // receiver's type, by path
        "src/app/Main.kt:15",                          // this file
        "src/app/Repo.kt:4",                           // this package
        "src/other/Saver.java:4",                      // the rest
    ])
    // `repo.save()`: Repo's save first
    #expect(paths(ix.navigate(["repo", "save"], in: main, line: 9)).first == "src/app/Repo.kt:4")
    // a type as the receiver, its companion's member
    #expect(ix.navigate(["Repo", "create"], in: main, line: 12) == .found(CodeLocation(path: "src/app/Repo.kt", line: 6)))
    // overloads are each a candidate; the imported file before another package
    #expect(paths(ix.navigate(["format"], in: main, line: 10)) == ["src/util/Format.kt:3", "src/util/Format.kt:4", "src/other/Format.kt:3"])
    // a bare name declared only below: ranked, this file first
    #expect(paths(ix.navigate(["save"], in: main, line: 13)).first == "src/app/Main.kt:15")
    // a type keeps the type result; nothing anywhere is none
    #expect(ix.navigate(["User"], in: main, line: 1) == .found(CodeLocation(path: "src/model/User.kt", line: 3)))
    #expect(ix.navigate(["nothing"], in: main, line: 1) == .none)
    // locals of other files never appear
    #expect(paths(ix.navigate(["force"], in: main, line: 1)).isEmpty)
}

@Test func typeCandidatesCarryTheirLine() {
    let ix = DeclIndex(files: ["a/Dup.kt": scanSource("package com.example.a\nclass Dup\n", java: false),
                               "b/Dup.kt": scanSource("package com.example.b\nclass Dup(val x: Int)\n", java: false)])
    #expect(ix.navigate(["Dup"], in: "x.kts", line: 1) == .many([
        Candidate(location: CodeLocation(path: "a/Dup.kt", line: 2), snippet: "class Dup"),
        Candidate(location: CodeLocation(path: "b/Dup.kt", line: 2), snippet: "class Dup(val x: Int)"),
    ]))
}
