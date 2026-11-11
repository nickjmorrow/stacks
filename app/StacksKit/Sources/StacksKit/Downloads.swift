// Every book in the library is kept on every device. These decide what to fetch and check what arrived.

import CryptoKit
import Foundation

public enum DownloadPlanner {
    public static let maxFailures = 3

    /// Books whose file is missing, gone from disk, or changed on the server (a new SHA-256), skipping
    /// books that already failed 3 times. `fileExists` takes the stored relative path.
    public static func needed(books: [LibraryBook], store: LocalStore, fileExists: (String) -> Bool) throws -> [LibraryBook] {
        try books.filter { b in
            if try store.downloadFailures(bookId: b.bookId, sha: b.fileSha256) >= maxFailures { return false }
            guard let local = try store.localFile(bookId: b.bookId) else { return true }
            return local.sha != b.fileSha256 || !fileExists(local.path)
        }
    }

    /// Books shown as "Couldn't download".
    public static func gaveUp(books: [LibraryBook], store: LocalStore) throws -> [LibraryBook] {
        try books.filter { try store.downloadFailures(bookId: $0.bookId, sha: $0.fileSha256) >= maxFailures }
    }
}

/// Which download problems count toward giving up on a book. Anything that could be a passing outage
/// (no answer, DNS, TLS, a 5xx while the server restarts) doesn't: the book is simply tried again later.
public enum DownloadFailure {
    /// `status` nil means no HTTP answer at all; `shaMatches` nil means the file wasn't checked.
    public static func counts(status: Int?, shaMatches: Bool?) -> Bool {
        if shaMatches == false { return true }
        return status == 404 || status == 410
    }
}

public enum FileVerifier {
    /// Hex SHA-256, read in 1 MB pieces.
    public static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
