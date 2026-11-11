// What the app hands the home-screen widget: the goal, minutes per day, and the books to pick up.
// The app writes it into the app-group container; the widget only reads it.

import Foundation

public struct WidgetBook: Codable, Equatable, Sendable {
    public var bookId: String
    public var name: String
    public var author: String?
    /// Path under the widget folder ("covers/<bookId>.jpg"), nil when no cover file was saved.
    public var cover: String?

    public init(bookId: String, name: String, author: String?, cover: String?) {
        self.bookId = bookId; self.name = name; self.author = author; self.cover = cover
    }
}

public struct WidgetSummary: Codable, Equatable, Sendable {
    public var generatedAt: Int64
    public var goalMinutes: Int
    /// Local date ("yyyy-MM-dd") → active seconds, for the last 400 days with any reading.
    public var days: [String: Int]
    /// The books being read, most recently read first (at most three).
    public var books: [WidgetBook]

    public init(generatedAt: Int64, goalMinutes: Int, days: [String: Int], books: [WidgetBook]) {
        self.generatedAt = generatedAt; self.goalMinutes = goalMinutes; self.days = days; self.books = books
    }

    /// What the widget shows before the app has written anything: no books, no reading.
    public static let empty = WidgetSummary(generatedAt: 0, goalMinutes: ReadingHabit.defaultGoalMinutes, days: [:], books: [])

    static let keepDays = 400
    public static let bookCount = 3

    public static func make(sessions: [Session], books: [LibraryBook], goalMinutes: Int, coverFiles: Set<String>,
                            now: Date, calendar: Calendar) -> WidgetSummary {
        let oldest = ReadingHabit.dayKey(calendar.date(byAdding: .day, value: -(keepDays - 1), to: now) ?? now, calendar: calendar)
        let days = ReadingHabit.secondsByDay(sessions, calendar: calendar).filter { $0.key >= oldest && $0.value > 0 }
        let shown = LibraryFilter.readingNow(books).prefix(bookCount).map {
            WidgetBook(bookId: $0.bookId, name: $0.name, author: $0.author,
                       cover: coverFiles.contains($0.bookId) ? WidgetFiles.coverName(bookId: $0.bookId) : nil)
        }
        return WidgetSummary(generatedAt: ms(now), goalMinutes: goalMinutes, days: days, books: shown)
    }
}

/// Where the summary and the cover images live inside the app-group container.
public enum WidgetFiles {
    public static func directory(in container: URL) -> URL {
        container.appendingPathComponent("widget", isDirectory: true)
    }

    static func summaryURL(in container: URL) -> URL { directory(in: container).appendingPathComponent("summary.json") }

    public static func coverName(bookId: String) -> String { "covers/\(bookId).jpg" }

    public static func coverURL(bookId: String, in container: URL) -> URL {
        directory(in: container).appendingPathComponent(coverName(bookId: bookId))
    }

    public static func write(_ summary: WidgetSummary, in container: URL) throws {
        try FileManager.default.createDirectory(at: directory(in: container), withIntermediateDirectories: true)
        try JSONEncoder().encode(summary).write(to: summaryURL(in: container), options: .atomic)
    }

    public static func read(in container: URL) -> WidgetSummary? {
        guard let data = try? Data(contentsOf: summaryURL(in: container)) else { return nil }
        return try? JSONDecoder().decode(WidgetSummary.self, from: data)
    }

    /// Deletes the saved covers of books no longer shown.
    public static func removeCovers(except bookIds: Set<String>, in container: URL) {
        let covers = directory(in: container).appendingPathComponent("covers", isDirectory: true)
        let files = (try? FileManager.default.contentsOfDirectory(at: covers, includingPropertiesForKeys: nil)) ?? []
        for file in files where file.pathExtension == "jpg" && !bookIds.contains(file.deletingPathExtension().lastPathComponent) {
            try? FileManager.default.removeItem(at: file)
        }
    }
}
