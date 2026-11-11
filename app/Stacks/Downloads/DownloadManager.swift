// Keeps a copy of every book on this device: fetches what DownloadPlanner says is needed, three at a
// time, checks each file's SHA-256, and files it under Application Support/Books (not backed up to iCloud).

import Foundation
import StacksKit

actor DownloadManager {
    let api: StacksAPI
    let store: LocalStore
    let root: URL
    private var running = false

    init(api: StacksAPI, store: LocalStore) {
        self.api = api
        self.store = store
        root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }

    /// The book's file on this device, if it has been downloaded and is still there.
    nonisolated func localURL(for bookId: String) -> URL? {
        guard let f = try? store.localFile(bookId: bookId) else { return nil }
        let url = root.appendingPathComponent(f.path)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// Downloads every missing or changed book. `progress(done, total)` is called after each one.
    func run(books: [LibraryBook], progress: @escaping @Sendable (Int, Int) -> Void) async {
        guard !running else { return }
        running = true
        defer { running = false }
        let root = root
        guard let needed = try? DownloadPlanner.needed(books: books, store: store, fileExists: {
            FileManager.default.fileExists(atPath: root.appendingPathComponent($0).path)
        }), !needed.isEmpty else { return }
        try? FileManager.default.createDirectory(at: root.appendingPathComponent("Books"), withIntermediateDirectories: true)
        var done = 0
        await withTaskGroup(of: Void.self) { group in
            var queue = needed[...]
            for _ in 0..<3 {
                guard let b = queue.popFirst() else { break }
                group.addTask { await self.fetch(b) }
            }
            for await _ in group {
                done += 1
                progress(done, needed.count)
                if let b = queue.popFirst() { group.addTask { await self.fetch(b) } }
            }
        }
    }

    /// Only a wrong file or a book gone from the server counts toward giving up; an outage (no answer,
    /// DNS, TLS, a 5xx while the server restarts) just means trying again on the next sync.
    private func fetch(_ book: LibraryBook) async {
        let relative = "Books/\(book.bookId).\(book.format.rawValue)"
        let dest = root.appendingPathComponent(relative)
        let fail = { try? self.store.noteDownloadFailure(bookId: book.bookId, sha: book.fileSha256) }
        guard let (tmp, res) = try? await URLSession.shared.download(from: api.fileURL(bookId: book.bookId)) else { return }
        defer { try? FileManager.default.removeItem(at: tmp) }
        let status = (res as? HTTPURLResponse)?.statusCode
        guard status == 200 else {
            if DownloadFailure.counts(status: status, shaMatches: nil) { fail() }
            return
        }
        guard let sha = try? FileVerifier.sha256(of: tmp), sha == book.fileSha256 else {
            fail()
            return
        }
        do {
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: tmp, to: dest)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var url = dest
            try? url.setResourceValues(values)
            try store.setLocalFile(bookId: book.bookId, path: relative, sha: book.fileSha256)
            try store.clearDownloadFailures(bookId: book.bookId)
        } catch {
            return // disk trouble: try again next time
        }
    }
}
