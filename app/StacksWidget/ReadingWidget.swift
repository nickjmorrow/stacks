// The Reading widget: the reading streak, this week, and the three books being read, each a tap away.
// It only reads what the app wrote into the app-group container (see StacksKit/WidgetSummary.swift).

import SwiftUI
import WidgetKit
import StacksKit

struct ReadingEntry: TimelineEntry {
    let date: Date
    /// nil until the app has synced once.
    let summary: WidgetSummary?
    /// The app-group container, where the cover images are.
    let container: URL?
}

struct ReadingProvider: TimelineProvider {
    func placeholder(in context: Context) -> ReadingEntry {
        ReadingEntry(date: Date(), summary: Self.sample(now: Date()), container: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ReadingEntry) -> Void) {
        let entry = Self.entry(at: Date())
        completion(entry.summary == nil ? placeholder(in: context) : entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReadingEntry>) -> Void) {
        let now = Date()
        let midnight = ReadingHabit.nextMidnight(after: now, calendar: .current)
        // Two entries from the same files: the streak and the week move on at midnight without the app running.
        let entries = [Self.entry(at: now), Self.entry(at: midnight)]
        completion(Timeline(entries: entries, policy: .after(midnight)))
    }

    private static func entry(at date: Date) -> ReadingEntry {
        let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroup.id)
        return ReadingEntry(date: date, summary: container.flatMap { WidgetFiles.read(in: $0) }, container: container)
    }

    /// Shown in the widget gallery and before the first sync.
    static func sample(now: Date) -> WidgetSummary {
        let calendar = Calendar.current
        var days: [String: Int] = [:]
        for back in 1...3 {
            days[ReadingHabit.dayKey(calendar.date(byAdding: .day, value: -back, to: now) ?? now, calendar: calendar)] = 420
        }
        days[ReadingHabit.dayKey(now, calendar: calendar)] = 180
        let books = [("How to Take Smart Notes", "Sönke Ahrens"), ("Effective TypeScript", "Dan Vanderkam"), ("Emotional Agility", "Susan David")]
        return WidgetSummary(generatedAt: 0, goalMinutes: 5, days: days,
                             books: books.enumerated().map { WidgetBook(bookId: "sample-\($0)", name: $1.0, author: $1.1, cover: nil) })
    }
}

struct ReadingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StacksReading", provider: ReadingProvider()) { entry in
            ReadingWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    // Black, with a thin gold line just inside the edge, like the deck's borders.
                    ZStack {
                        Marigold.black
                        ContainerRelativeShape().inset(by: 6).stroke(Marigold.gold.opacity(0.55), lineWidth: 1)
                    }
                }
        }
        .configurationDisplayName("Reading")
        .description("Your streak, this week, and the books to pick up.")
        .supportedFamilies([.systemMedium])
    }
}
