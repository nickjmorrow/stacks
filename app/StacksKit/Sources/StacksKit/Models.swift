// The JSON the Stacks server speaks (src/shared/api.ts). Shapes are pinned by app-fixtures/*.json.

import Foundation

/// Any JSON value, kept exactly (Readium locators are stored and passed on without interpretation).
public enum JSONValue: Codable, Equatable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var numberValue: Double? {
        if case .number(let n) = self { return n }
        return nil
    }

    /// As a JSON string (Readium's `Locator(jsonString:)` takes one).
    public func jsonString() -> String {
        (try? String(decoding: JSONEncoder().encode(self), as: UTF8.self)) ?? "null"
    }

    public static func parse(_ json: String) -> JSONValue? {
        try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
    }
}

public enum BookStatus: String, Codable, Sendable, CaseIterable {
    case want, doing, done, dropped

    public var label: String {
        switch self {
        case .want: "Want"
        case .doing: "Reading"
        case .done: "Read"
        case .dropped: "Gave up"
        }
    }
}

public enum BookFormat: String, Codable, Sendable { case epub, pdf }

public struct LibraryBook: Codable, Identifiable, Equatable, Hashable, Sendable {
    public var bookId: String
    public var pageId: String
    public var pageTitle: String
    public var name: String
    public var status: BookStatus
    public var tags: [String]
    public var rating: Int?
    public var rec: String?
    public var finished: String?
    public var progress: String?
    public var year: Int?
    public var genre: [String]?
    public var summary: String?
    public var author: String?
    public var format: BookFormat
    public var fileSize: Int
    public var fileSha256: String
    public var coverUrl: String?
    public var isbn: String?
    public var appleBooksId: String?
    public var addedAt: Int64
    public var lookupState: String
    public var lastReadAt: Int64?
    public var pendingEdit: Bool

    public var id: String { bookId }
}

public struct TagInfo: Codable, Equatable, Hashable, Sendable {
    public var title: String
    public var group: String?
    public var count: Int
}

public struct LibraryResponse: Codable, Equatable, Sendable {
    public var books: [LibraryBook]
    public var tags: [TagInfo]
    public var cursor: Int64
}

public struct Position: Codable, Equatable, Sendable {
    public var bookId: String
    public var device: String
    public var locator: JSONValue
    /// 0 to 1 through the whole book
    public var progression: Double
    /// ms since epoch
    public var updatedAt: Int64

    public init(bookId: String, device: String, locator: JSONValue, progression: Double, updatedAt: Int64) {
        self.bookId = bookId; self.device = device; self.locator = locator; self.progression = progression; self.updatedAt = updatedAt
    }
}

public struct Session: Codable, Equatable, Sendable {
    public var sessionId: String
    public var bookId: String
    public var device: String
    public var startedAt: Int64
    public var endedAt: Int64
    public var activeSeconds: Int
    public var startProgression: Double
    public var endProgression: Double
    public var pagesTurned: Int

    public init(sessionId: String, bookId: String, device: String, startedAt: Int64, endedAt: Int64, activeSeconds: Int,
                startProgression: Double, endProgression: Double, pagesTurned: Int) {
        self.sessionId = sessionId; self.bookId = bookId; self.device = device; self.startedAt = startedAt; self.endedAt = endedAt
        self.activeSeconds = activeSeconds; self.startProgression = startProgression; self.endProgression = endProgression
        self.pagesTurned = pagesTurned
    }
}

public enum AnnotationKind: String, Codable, Sendable { case highlight, note }
public enum HighlightColor: String, Codable, Sendable, CaseIterable { case yellow, blue, green, pink, purple }
public enum AnnotationSource: String, Codable, Sendable {
    case stacks
    case appleBooks = "apple-books"
}

public struct Annotation: Codable, Equatable, Identifiable, Sendable {
    public var annotationId: String
    public var bookId: String
    public var kind: AnnotationKind
    public var color: HighlightColor
    public var locator: JSONValue
    public var text: String
    public var note: String?
    public var createdAt: Int64
    public var updatedAt: Int64
    public var deletedAt: Int64?
    public var device: String
    public var source: AnnotationSource

    public var id: String { annotationId }

    /// False for highlights whose chapter couldn't be found (some imported from Apple Books); they're listed, never drawn.
    public var isPlaced: Bool { !(locator["href"]?.stringValue ?? "").isEmpty }

    public init(annotationId: String, bookId: String, kind: AnnotationKind, color: HighlightColor, locator: JSONValue, text: String,
                note: String?, createdAt: Int64, updatedAt: Int64, deletedAt: Int64?, device: String, source: AnnotationSource) {
        self.annotationId = annotationId; self.bookId = bookId; self.kind = kind; self.color = color; self.locator = locator
        self.text = text; self.note = note; self.createdAt = createdAt; self.updatedAt = updatedAt; self.deletedAt = deletedAt
        self.device = device; self.source = source
    }

    // The server sends `note` and `deletedAt` as explicit nulls; keep them in the JSON.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(annotationId, forKey: .annotationId); try c.encode(bookId, forKey: .bookId)
        try c.encode(kind, forKey: .kind); try c.encode(color, forKey: .color); try c.encode(locator, forKey: .locator)
        try c.encode(text, forKey: .text); try c.encode(note, forKey: .note); try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt); try c.encode(deletedAt, forKey: .deletedAt)
        try c.encode(device, forKey: .device); try c.encode(source, forKey: .source)
    }
}

public struct SyncRequest: Codable, Equatable, Sendable {
    public var device: String
    public var since: Int64
    public var positions: [Position]
    public var sessions: [Session]
    public var annotations: [Annotation]
    /// The book just closed: the server writes its progress to Grimoire.
    public var closing: String?

    public init(device: String, since: Int64, positions: [Position], sessions: [Session], annotations: [Annotation], closing: String? = nil) {
        self.device = device; self.since = since; self.positions = positions; self.sessions = sessions; self.annotations = annotations
        self.closing = closing
    }
}

public struct SyncResponse: Codable, Equatable, Sendable {
    public var cursor: Int64
    public var positions: [Position]
    public var sessions: [Session]
    public var annotations: [Annotation]

    public init(cursor: Int64, positions: [Position] = [], sessions: [Session] = [], annotations: [Annotation] = []) {
        self.cursor = cursor; self.positions = positions; self.sessions = sessions; self.annotations = annotations
    }
}

/// One field of a PATCH: left alone, set, or cleared (sent as null).
public enum Patch<T: Codable & Equatable & Sendable>: Equatable, Sendable {
    case unchanged, set(T), clear
}

/// A change to a book's Grimoire fields, sent as PATCH /api/books/:id.
public struct BookPatch: Codable, Equatable, Sendable {
    public var status: Patch<BookStatus> = .unchanged
    public var rating: Patch<Int> = .unchanged
    public var rec: Patch<String> = .unchanged
    public var finished: Patch<String> = .unchanged
    public var tags: [String]?

    public init(status: Patch<BookStatus> = .unchanged, rating: Patch<Int> = .unchanged, rec: Patch<String> = .unchanged,
                finished: Patch<String> = .unchanged, tags: [String]? = nil) {
        self.status = status; self.rating = rating; self.rec = rec; self.finished = finished; self.tags = tags
    }

    enum CodingKeys: String, CodingKey { case status, rating, rec, finished, tags }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        func put<T>(_ p: Patch<T>, _ key: CodingKeys) throws {
            switch p {
            case .unchanged: break
            case .set(let v): try c.encode(v, forKey: key)
            case .clear: try c.encodeNil(forKey: key)
            }
        }
        try put(status, .status); try put(rating, .rating); try put(rec, .rec); try put(finished, .finished)
        if let tags { try c.encode(tags, forKey: .tags) }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func get<T>(_ key: CodingKeys) throws -> Patch<T> {
            guard c.contains(key) else { return .unchanged }
            return try c.decodeNil(forKey: key) ? .clear : .set(try c.decode(T.self, forKey: key))
        }
        status = try get(.status); rating = try get(.rating); rec = try get(.rec); finished = try get(.finished)
        tags = try c.decodeIfPresent([String].self, forKey: .tags)
    }

    public var isEmpty: Bool { self == BookPatch() }
}
