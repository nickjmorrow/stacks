import Foundation
import Testing
@testable import StacksKit

@Suite struct DownloadsTests {
    let store = try! LocalStore(path: nil)

    func b(_ id: String, sha: String) -> LibraryBook {
        var x = book(id, "Book \(id)")
        x.fileSha256 = sha
        return x
    }

    @Test func plansMissingFiles() throws {
        try store.setLocalFile(bookId: "1", path: "Books/1.epub", sha: "s1")
        let needed = try DownloadPlanner.needed(books: [b("1", sha: "s1"), b("2", sha: "s2")], store: store, fileExists: { _ in true })
        #expect(needed.map(\.bookId) == ["2"])
    }

    @Test func plansAChangedShaOrAFileThatIsGone() throws {
        try store.setLocalFile(bookId: "1", path: "Books/1.epub", sha: "old")
        try store.setLocalFile(bookId: "3", path: "Books/3.epub", sha: "s3")
        let needed = try DownloadPlanner.needed(books: [b("1", sha: "new"), b("3", sha: "s3")], store: store,
                                                fileExists: { $0 != "Books/3.epub" })
        #expect(needed.map(\.bookId) == ["1", "3"])
    }

    @Test func skipsABookAfterThreeFailures() throws {
        for _ in 0..<3 { try store.noteDownloadFailure(bookId: "2", sha: "s2") }
        #expect(try DownloadPlanner.needed(books: [b("2", sha: "s2")], store: store, fileExists: { _ in true }).isEmpty)
        #expect(try DownloadPlanner.gaveUp(books: [b("2", sha: "s2")], store: store).map(\.bookId) == ["2"])
    }

    @Test func sha256OfAKnownFile() throws {
        let f = FileManager.default.temporaryDirectory.appendingPathComponent("sha-\(UUID())")
        try Data("abc".utf8).write(to: f)
        #expect(try FileVerifier.sha256(of: f) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
