import Foundation
import Testing
@testable import StacksKit

@Suite struct WidgetSummaryTests {
    let now = local(2026, 10, 30)

    func make(_ books: [LibraryBook], sessions: [Session] = [], covers: Set<String> = []) -> WidgetSummary {
        WidgetSummary.make(sessions: sessions, books: books, goalMinutes: 5, coverFiles: covers, now: now, calendar: newYork)
    }

    @Test func makeKeepsTheFirstThreeReadingBooksMostRecentFirst() {
        let books = [
            book("1", "One", status: .doing, lastRead: 10), book("2", "Two", status: .doing, lastRead: 50),
            book("3", "Three", status: .doing, lastRead: 30), book("4", "Four", status: .done, lastRead: 99),
            book("5", "Five", status: .doing, lastRead: 20), book("6", "Six", status: .doing, lastRead: 40),
        ]
        #expect(make(books).books.map(\.bookId) == ["2", "6", "3"])
    }

    @Test func makeWithFewerThanThreeBooksKeepsThemAll() {
        let all = [book("1", "One", status: .doing, lastRead: 10), book("2", "Two", status: .doing, lastRead: 20)]
        #expect(make([]).books.isEmpty)
        #expect(make(Array(all.prefix(1))).books.map(\.bookId) == ["1"])
        #expect(make(all).books.map(\.bookId) == ["2", "1"])
    }

    @Test func coverIsSetOnlyForBooksWithAFile() {
        let books = [book("b1", "One", status: .doing, author: "A", lastRead: 20), book("b2", "Two", status: .doing, lastRead: 10)]
        let s = make(books, covers: ["b1"])
        #expect(s.books[0].cover == "covers/b1.jpg")
        #expect(s.books[0].author == "A")
        #expect(s.books[1].cover == nil)
    }

    @Test func makeKeepsDaysWithReadingFromTheLast400DaysOnly() {
        let recent = habitSession("a", ended: newYork.date(byAdding: .day, value: -399, to: now)!, seconds: 60)
        let old = habitSession("b", ended: newYork.date(byAdding: .day, value: -401, to: now)!, seconds: 60)
        let s = make([], sessions: [recent, old])
        #expect(s.days.count == 1)
        #expect(s.days.values.first == 60)
        #expect(s.goalMinutes == 5)
        #expect(s.generatedAt == Int64(now.timeIntervalSince1970 * 1000))
    }

    @Test func emptySummaryHasNothingToShowAndTheDefaultGoal() {
        let empty = WidgetSummary.empty
        #expect(empty.books.isEmpty)
        #expect(empty.days.isEmpty)
        #expect(empty.goalMinutes == ReadingHabit.defaultGoalMinutes)
        #expect(ReadingHabit.streak(empty.days, goalMinutes: empty.goalMinutes, now: now, calendar: newYork) == 0)
    }

    @Test func summaryRoundTripsThroughFiles() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        #expect(WidgetFiles.read(in: dir) == nil)
        let s = make([book("b1", "One", status: .doing, lastRead: 1)], sessions: [habitSession("a", ended: now, seconds: 90)], covers: ["b1"])
        try WidgetFiles.write(s, in: dir)
        #expect(WidgetFiles.read(in: dir) == s)
        #expect(WidgetFiles.directory(in: dir).lastPathComponent == "widget")
    }

    @Test func removeCoversDeletesFilesForBooksNoLongerShown() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let a = WidgetFiles.coverURL(bookId: "a", in: dir)
        let b = WidgetFiles.coverURL(bookId: "b", in: dir)
        try FileManager.default.createDirectory(at: a.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data([1]).write(to: a)
        try Data([2]).write(to: b)
        WidgetFiles.removeCovers(except: ["a"], in: dir)
        #expect(FileManager.default.fileExists(atPath: a.path))
        #expect(!FileManager.default.fileExists(atPath: b.path))
    }
}
