import SwiftUI
import UIKit
import WidgetKit
import StacksKit

struct ReadingWidgetView: View {
    let entry: ReadingEntry

    private var summary: WidgetSummary { entry.summary ?? .empty }
    private let calendar = Calendar.current

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            covers
            VStack(alignment: .leading, spacing: 8) {
                headline
                weekStrip
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .widgetURL(URL(string: "stacks://library"))
    }

    // MARK: - books

    @ViewBuilder private var covers: some View {
        if summary.books.isEmpty {
            Text("Pick a book in Stacks")
                .font(.system(size: 13, design: .serif).italic())
                .foregroundStyle(Marigold.white)
                .frame(width: 174, alignment: .leading)
        } else {
            HStack(spacing: 6) {
                ForEach(Array(summary.books.enumerated()), id: \.element.bookId) { index, book in
                    Link(destination: DeepLink.url(book: book.bookId)) {
                        WidgetCover(book: book, container: entry.container, latest: index == 0)
                    }
                    .accessibilityLabel(book.name)
                }
            }
        }
    }

    // MARK: - habit

    private var headline: some View {
        let streak = ReadingHabit.streak(summary.days, goalMinutes: summary.goalMinutes, now: entry.date, calendar: calendar)
        let minutes = ReadingHabit.minutesToday(summary.days, now: entry.date, calendar: calendar)
        return VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Image(systemName: "flame.fill")
                Text(streak == 1 ? "1 day" : "\(streak) days")
            }
            .font(.system(size: 17, weight: .semibold, design: .serif))
            .foregroundStyle(Marigold.gold)
            Text("\(minutes) of \(summary.goalMinutes) min today")
                .font(.system(size: 11, design: .serif).italic())
                .foregroundStyle(Marigold.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private var weekStrip: some View {
        let week = ReadingHabit.week(summary.days, goalMinutes: summary.goalMinutes, now: entry.date, calendar: calendar)
        return HStack(spacing: 3) {
            ForEach(Array(week.enumerated()), id: \.offset) { _, day in
                VStack(spacing: 2) {
                    ZStack(alignment: .bottom) {
                        RoundedRectangle(cornerRadius: 2).fill(Marigold.gold.opacity(0.16))
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Marigold.gold.opacity(day.fill >= 1 ? 1 : 0.6))
                            .frame(height: 22 * day.fill)
                    }
                    .frame(height: 22)
                    Text(day.letter)
                        .font(.system(size: 10, design: .serif))
                        .foregroundStyle(day.isToday ? Marigold.white : Marigold.gold.opacity(0.8))
                }
            }
        }
    }
}

/// A book's saved cover, or one drawn from its title (as the app does) when no image file was saved.
struct WidgetCover: View {
    let book: WidgetBook
    let container: URL?
    let latest: Bool

    private var image: UIImage? {
        guard book.cover != nil, let container else { return nil }
        return UIImage(contentsOfFile: WidgetFiles.coverURL(bookId: book.bookId, in: container).path)
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                generated
            }
        }
        .frame(width: 54, height: 81)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .overlay(RoundedRectangle(cornerRadius: 3).stroke(latest ? Marigold.gold : Marigold.gold.opacity(0.45), lineWidth: latest ? 1.5 : 0.5))
    }

    private var generated: some View {
        VStack(alignment: .leading, spacing: 3) {
            Rectangle().fill(Marigold.gold).frame(width: 16, height: 1.5)
            Text(book.name)
                .font(.system(size: 8, weight: .semibold, design: .serif))
                .foregroundStyle(Marigold.white)
                .lineLimit(5)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
            if let author = book.author {
                Text(author).font(.system(size: 6, design: .serif)).foregroundStyle(Marigold.gold).lineLimit(2)
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Marigold.black)
    }
}
