// The library's search, filters and sort (Hoard's filter list, for books).

import Foundation

public struct LibraryFilter: Equatable, Sendable {
    public enum Sort: String, CaseIterable, Sendable {
        case recentlyRead, title, author, year, rating, added

        public var label: String {
            switch self {
            case .recentlyRead: "Recently read"
            case .title: "Title"
            case .author: "Author"
            case .year: "Year"
            case .rating: "Your rating"
            case .added: "Recently added"
            }
        }
    }

    public var search = ""
    public var statuses: Set<BookStatus> = []
    /// Tag group name → picked tags. Two picks in one group mean either; picks across groups must all match.
    public var tagsByGroup: [String: Set<String>] = [:]
    public var sort: Sort = .recentlyRead

    public init() {}

    public static let otherGroup = "Other"

    public var isActive: Bool { !search.isEmpty || !statuses.isEmpty || tagsByGroup.values.contains { !$0.isEmpty } }

    /// The folded text a search matches against. Build it once per library change (folding is the slow part),
    /// then pass it to `apply` so typing only does substring checks.
    public static func haystack(_ b: LibraryBook) -> String {
        fold([b.name, b.author ?? "", b.rec ?? "", b.summary ?? "", b.tags.joined(separator: " ")].joined(separator: " "))
    }

    public static func haystacks(_ books: [LibraryBook]) -> [String: String] {
        Dictionary(books.map { ($0.bookId, haystack($0)) }, uniquingKeysWith: { a, _ in a })
    }

    public func apply(_ books: [LibraryBook], tags: [TagInfo], haystacks: [String: String]? = nil) -> [LibraryBook] {
        let words = Self.fold(search).split(separator: " ").map(String.init)
        let filtered = books.filter { b in
            if !statuses.isEmpty && !statuses.contains(b.status) { return false }
            for (_, picked) in tagsByGroup where !picked.isEmpty {
                if !b.tags.contains(where: { picked.contains($0) }) { return false }
            }
            if !words.isEmpty {
                let hay = haystacks?[b.bookId] ?? Self.haystack(b)
                if !words.allSatisfy({ hay.contains($0) }) { return false }
            }
            return true
        }
        return filtered.sorted(by: order)
    }

    private func order(_ a: LibraryBook, _ b: LibraryBook) -> Bool {
        func titleKey(_ x: LibraryBook) -> String { Self.fold(x.name).replacing(#/^(the|a|an) /#, with: "") }
        func lastName(_ x: LibraryBook) -> String {
            guard let author = x.author else { return "\u{10FFFF}" }
            let first = author.components(separatedBy: CharacterSet(charactersIn: ",&;")).first ?? author
            let parts = Self.fold(first).split(separator: " ")
            // "García Márquez" and other two-word surnames sort by the first of the last two words only when the name has 3+ words.
            return parts.count >= 3 ? parts.suffix(2).joined(separator: " ") : String(parts.last ?? "")
        }
        func newer<T: Comparable>(_ x: T?, _ y: T?) -> Bool? {
            switch (x, y) {
            case let (x?, y?) where x != y: return x > y
            case (.some, nil): return true
            case (nil, .some): return false
            default: return nil
            }
        }
        let tie = titleKey(a) < titleKey(b)
        switch sort {
        case .title: return tie
        case .author: let (x, y) = (lastName(a), lastName(b)); return x == y ? tie : x < y
        case .year: return newer(a.year, b.year) ?? tie
        case .rating: return newer(a.rating, b.rating) ?? tie
        case .added: return a.addedAt == b.addedAt ? tie : a.addedAt > b.addedAt
        case .recentlyRead: return newer(a.lastReadAt, b.lastReadAt) ?? (a.addedAt == b.addedAt ? tie : a.addedAt > b.addedAt)
        }
    }

    /// Books being read, most recently read first.
    public static func readingNow(_ books: [LibraryBook]) -> [LibraryBook] {
        var f = LibraryFilter()
        f.statuses = [.doing]
        f.sort = .recentlyRead
        return f.apply(books, tags: [])
    }

    public struct Group: Equatable, Sendable { public var name: String; public var tags: [String] }

    /// Tag groups in name order, ungrouped tags last under "Other".
    public static func groups(_ tags: [TagInfo]) -> [Group] {
        var byGroup: [String: [String]] = [:]
        for t in tags { byGroup[t.group ?? otherGroup, default: []].append(t.title) }
        let names = byGroup.keys.filter { $0 != otherGroup }.sorted() + (byGroup[otherGroup] == nil ? [] : [otherGroup])
        return names.map { Group(name: $0, tags: byGroup[$0]!.sorted()) }
    }

    /// Lowercase, accents removed, punctuation to spaces.
    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
            .replacing(/[^\p{L}\p{N}]+/, with: " ").trimmingCharacters(in: .whitespaces)
    }
}
