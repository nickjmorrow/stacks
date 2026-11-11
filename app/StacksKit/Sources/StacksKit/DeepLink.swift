// Links into the app: `stacks://book/<bookId>` opens a book in the reader; `stacks://library` just opens the app.
// The home-screen widget uses both.

import Foundation

public enum DeepLink: Equatable, Sendable {
    case book(String)
    case library

    public init?(url: URL) {
        guard url.scheme == "stacks" else { return nil }
        switch url.host {
        case "library":
            self = .library
        case "book":
            let id = String(url.path.drop { $0 == "/" })
            guard !id.isEmpty else { return nil }
            self = .book(id)
        default:
            return nil
        }
    }

    public static func url(book id: String) -> URL {
        var parts = URLComponents()
        parts.scheme = "stacks"
        parts.host = "book"
        parts.path = "/" + id
        return parts.url!
    }
}
