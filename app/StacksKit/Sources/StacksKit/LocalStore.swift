// The device's own database (GRDB): the last library from the server, positions, reading sessions,
// highlights and notes, and everything waiting to be sent. Rows are kept as JSON with a few indexed columns.

import Foundation
import GRDB

public struct QueuedEdit: Equatable, Sendable { public var id: Int64; public var bookId: String; public var patch: BookPatch }
public struct QueuedUpload: Equatable, Sendable { public var id: Int64; public var path: String; public var name: String }

public final class LocalStore: Sendable {
    private let db: DatabaseQueue

    /// `path` nil keeps the database in memory (tests).
    public init(path: String?) throws {
        // The app and the share extension share this file: wait for each other's locks instead of failing.
        var config = Configuration()
        config.busyMode = .timeout(5)
        db = try path.map { try DatabaseQueue(path: $0, configuration: config) } ?? DatabaseQueue(configuration: config)
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { db in
            try db.execute(sql: """
                CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE library (id INTEGER PRIMARY KEY CHECK (id = 1), json BLOB NOT NULL);
                CREATE TABLE positions (bookId TEXT NOT NULL, device TEXT NOT NULL, json BLOB NOT NULL, updatedAt INTEGER NOT NULL,
                  dirty INTEGER NOT NULL, PRIMARY KEY (bookId, device));
                CREATE TABLE sessions (sessionId TEXT PRIMARY KEY, bookId TEXT NOT NULL, json BLOB NOT NULL, endedAt INTEGER NOT NULL,
                  dirty INTEGER NOT NULL);
                CREATE TABLE annotations (annotationId TEXT PRIMARY KEY, bookId TEXT NOT NULL, json BLOB NOT NULL,
                  updatedAt INTEGER NOT NULL, deletedAt INTEGER, createdAt INTEGER NOT NULL, dirty INTEGER NOT NULL);
                CREATE INDEX annotations_book ON annotations (bookId);
                CREATE TABLE edits (id INTEGER PRIMARY KEY AUTOINCREMENT, bookId TEXT NOT NULL, json BLOB NOT NULL);
                CREATE TABLE uploads (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL);
                CREATE TABLE files (bookId TEXT PRIMARY KEY, path TEXT NOT NULL, sha TEXT NOT NULL);
                CREATE TABLE failures (bookId TEXT PRIMARY KEY, count INTEGER NOT NULL);
                """)
        }
        migrator.registerMigration("v2-failures-by-file") { db in
            // A failure counts against one version of a file; a new file on the server starts over.
            try db.execute(sql: """
                DROP TABLE failures;
                CREATE TABLE failures (bookId TEXT PRIMARY KEY, sha TEXT NOT NULL, count INTEGER NOT NULL);
                """)
        }
        try migrator.migrate(db)
    }

    private static let enc = JSONEncoder()
    private static let dec = JSONDecoder()
    private func json<T: Encodable>(_ v: T) throws -> Data { try Self.enc.encode(v) }
    private func value<T: Decodable>(_ d: Data) throws -> T { try Self.dec.decode(T.self, from: d) }

    // MARK: - settings, device, cursor

    public func setting(_ key: String) throws -> String? {
        try db.read { try String.fetchOne($0, sql: "SELECT value FROM meta WHERE key = ?", arguments: [key]) }
    }

    public func setSetting(_ key: String, _ value: String) throws {
        try db.write { try $0.execute(sql: "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", arguments: [key, value]) }
    }

    /// "iPhone-3fa2": made once per install.
    public func device(kind: String) throws -> String {
        try db.write { db in
            if let d = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'device'") { return d }
            let d = "\(kind)-\(String(format: "%04x", UInt16.random(in: .min ... .max)))"
            try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('device', ?)", arguments: [d])
            return d
        }
    }

    /// Minutes of reading that make a day count for the habit.
    public func goalMinutes() throws -> Int {
        try setting("goalMinutes").flatMap { Int($0) } ?? ReadingHabit.defaultGoalMinutes
    }

    public func setGoalMinutes(_ minutes: Int) throws {
        try setSetting("goalMinutes", String(min(max(minutes, 1), 120)))
    }

    public func cursor() throws -> Int64 { Int64(try setting("cursor") ?? "0") ?? 0 }
    public func setCursor(_ c: Int64) throws { try setSetting("cursor", String(c)) }

    // MARK: - library

    public func saveLibrary(_ lib: LibraryResponse) throws {
        let data = try json(lib)
        try db.write { try $0.execute(sql: "INSERT OR REPLACE INTO library (id, json) VALUES (1, ?)", arguments: [data]) }
    }

    public func library() throws -> LibraryResponse? {
        guard let data = try db.read({ try Data.fetchOne($0, sql: "SELECT json FROM library WHERE id = 1") }) else { return nil }
        return try value(data)
    }

    // MARK: - positions

    /// Applied when new or strictly newer for that book and device.
    @discardableResult
    public func putPosition(_ p: Position, dirty: Bool) throws -> Bool {
        let data = try json(p)
        return try db.write { db in
            let have = try Int64.fetchOne(db, sql: "SELECT updatedAt FROM positions WHERE bookId = ? AND device = ?", arguments: [p.bookId, p.device])
            if let have, have >= p.updatedAt { return false }
            try db.execute(sql: "INSERT OR REPLACE INTO positions (bookId, device, json, updatedAt, dirty) VALUES (?, ?, ?, ?, ?)",
                           arguments: [p.bookId, p.device, data, p.updatedAt, dirty])
            return true
        }
    }

    public func position(bookId: String, device: String) throws -> Position? {
        try db.read { try Data.fetchOne($0, sql: "SELECT json FROM positions WHERE bookId = ? AND device = ?", arguments: [bookId, device]) }
            .map { try value($0) }
    }

    public func positions(bookId: String) throws -> [Position] {
        try db.read { try Data.fetchAll($0, sql: "SELECT json FROM positions WHERE bookId = ? ORDER BY updatedAt DESC", arguments: [bookId]) }
            .map { try value($0) }
    }

    public func dirtyPositions(limit: Int) throws -> [Position] {
        try db.read { try Data.fetchAll($0, sql: "SELECT json FROM positions WHERE dirty = 1 ORDER BY updatedAt LIMIT ?", arguments: [limit]) }
            .map { try value($0) }
    }

    /// Clears dirty only for rows unchanged since they were sent.
    public func markSent(positions: [Position]) throws {
        try db.write { db in
            for p in positions {
                try db.execute(sql: "UPDATE positions SET dirty = 0 WHERE bookId = ? AND device = ? AND updatedAt = ?",
                               arguments: [p.bookId, p.device, p.updatedAt])
            }
        }
    }

    // MARK: - sessions

    /// A session grows while it's open: replaced only by one with a later end.
    @discardableResult
    public func putSession(_ s: Session, dirty: Bool) throws -> Bool {
        let data = try json(s)
        return try db.write { db in
            let have = try Int64.fetchOne(db, sql: "SELECT endedAt FROM sessions WHERE sessionId = ?", arguments: [s.sessionId])
            if let have, have >= s.endedAt { return false }
            try db.execute(sql: "INSERT OR REPLACE INTO sessions (sessionId, bookId, json, endedAt, dirty) VALUES (?, ?, ?, ?, ?)",
                           arguments: [s.sessionId, s.bookId, data, s.endedAt, dirty])
            return true
        }
    }

    public func dirtySessions(limit: Int) throws -> [Session] {
        try db.read { try Data.fetchAll($0, sql: "SELECT json FROM sessions WHERE dirty = 1 ORDER BY endedAt LIMIT ?", arguments: [limit]) }
            .map { try value($0) }
    }

    /// Sessions from every device that ended after the given time (ms), oldest first.
    public func sessions(endedAfter ms: Int64) throws -> [Session] {
        try db.read { try Data.fetchAll($0, sql: "SELECT json FROM sessions WHERE endedAt > ? ORDER BY endedAt", arguments: [ms]) }
            .map { try value($0) }
    }

    public func markSent(sessions: [Session]) throws {
        try db.write { db in
            for s in sessions {
                try db.execute(sql: "UPDATE sessions SET dirty = 0 WHERE sessionId = ? AND endedAt = ?", arguments: [s.sessionId, s.endedAt])
            }
        }
    }

    // MARK: - annotations

    /// Applied when new or strictly newer (the server's rule), so an equal or older edit never wins.
    @discardableResult
    public func putAnnotation(_ a: Annotation, dirty: Bool) throws -> Bool {
        let data = try json(a)
        return try db.write { db in
            let have = try Int64.fetchOne(db, sql: "SELECT updatedAt FROM annotations WHERE annotationId = ?", arguments: [a.annotationId])
            if let have, have >= a.updatedAt { return false }
            try db.execute(sql: """
                INSERT OR REPLACE INTO annotations (annotationId, bookId, json, updatedAt, deletedAt, createdAt, dirty)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, arguments: [a.annotationId, a.bookId, data, a.updatedAt, a.deletedAt, a.createdAt, dirty])
            return true
        }
    }

    /// Not deleted, oldest first.
    public func annotations(bookId: String) throws -> [Annotation] {
        try db.read {
            try Data.fetchAll($0, sql: "SELECT json FROM annotations WHERE bookId = ? AND deletedAt IS NULL ORDER BY createdAt", arguments: [bookId])
        }.map { try value($0) }
    }

    public func annotation(id: String) throws -> Annotation? {
        try db.read { try Data.fetchOne($0, sql: "SELECT json FROM annotations WHERE annotationId = ?", arguments: [id]) }.map { try value($0) }
    }

    public func dirtyAnnotations(limit: Int) throws -> [Annotation] {
        try db.read { try Data.fetchAll($0, sql: "SELECT json FROM annotations WHERE dirty = 1 ORDER BY updatedAt LIMIT ?", arguments: [limit]) }
            .map { try value($0) }
    }

    public func markSent(annotations: [Annotation]) throws {
        try db.write { db in
            for a in annotations {
                try db.execute(sql: "UPDATE annotations SET dirty = 0 WHERE annotationId = ? AND updatedAt = ?", arguments: [a.annotationId, a.updatedAt])
            }
        }
    }

    // MARK: - queued edits and uploads

    public func enqueueEdit(bookId: String, patch: BookPatch) throws {
        let data = try json(patch)
        try db.write { try $0.execute(sql: "INSERT INTO edits (bookId, json) VALUES (?, ?)", arguments: [bookId, data]) }
    }

    public func pendingEdits() throws -> [QueuedEdit] {
        try db.read { try Row.fetchAll($0, sql: "SELECT id, bookId, json FROM edits ORDER BY id") }
            .map { QueuedEdit(id: $0["id"], bookId: $0["bookId"], patch: try value($0["json"])) }
    }

    public func removeEdit(id: Int64) throws {
        try db.write { try $0.execute(sql: "DELETE FROM edits WHERE id = ?", arguments: [id]) }
    }

    public func enqueueUpload(path: String, name: String) throws {
        try db.write { try $0.execute(sql: "INSERT INTO uploads (path, name) VALUES (?, ?)", arguments: [path, name]) }
    }

    public func pendingUploads() throws -> [QueuedUpload] {
        try db.read { try Row.fetchAll($0, sql: "SELECT id, path, name FROM uploads ORDER BY id") }
            .map { QueuedUpload(id: $0["id"], path: $0["path"], name: $0["name"]) }
    }

    public func removeUpload(id: Int64) throws {
        try db.write { try $0.execute(sql: "DELETE FROM uploads WHERE id = ?", arguments: [id]) }
    }

    // MARK: - downloaded files

    public func localFile(bookId: String) throws -> (path: String, sha: String)? {
        try db.read { try Row.fetchOne($0, sql: "SELECT path, sha FROM files WHERE bookId = ?", arguments: [bookId]) }
            .map { (path: $0["path"], sha: $0["sha"]) }
    }

    public func setLocalFile(bookId: String, path: String, sha: String) throws {
        try db.write {
            try $0.execute(sql: "INSERT OR REPLACE INTO files (bookId, path, sha) VALUES (?, ?, ?)", arguments: [bookId, path, sha])
            try $0.execute(sql: "DELETE FROM failures WHERE bookId = ?", arguments: [bookId])
        }
    }

    public func removeLocalFile(bookId: String) throws {
        try db.write { try $0.execute(sql: "DELETE FROM files WHERE bookId = ?", arguments: [bookId]) }
    }

    public func downloadFailures(bookId: String, sha: String) throws -> Int {
        try db.read { try Int.fetchOne($0, sql: "SELECT count FROM failures WHERE bookId = ? AND sha = ?", arguments: [bookId, sha]) } ?? 0
    }

    public func noteDownloadFailure(bookId: String, sha: String) throws {
        try db.write {
            try $0.execute(sql: """
                INSERT INTO failures (bookId, sha, count) VALUES (?, ?, 1)
                ON CONFLICT(bookId) DO UPDATE SET count = CASE WHEN sha = excluded.sha THEN count + 1 ELSE 1 END, sha = excluded.sha
                """, arguments: [bookId, sha])
        }
    }

    /// "Try again".
    public func clearDownloadFailures(bookId: String) throws {
        try db.write { try $0.execute(sql: "DELETE FROM failures WHERE bookId = ?", arguments: [bookId]) }
    }
}
