// Hands the home-screen widget what it shows: the habit summary and the covers of the books being read,
// written into the app-group container. The widget never talks to the server.

import Foundation
import UIKit
import WidgetKit
import StacksKit

@MainActor
enum WidgetBridge {
    /// Covers are saved this wide (points); the widget draws them at most about 60 points wide.
    private static let coverWidth: CGFloat = 200

    /// Covers that couldn't be fetched ("bookId|url"): not tried again until the app restarts.
    private static var failedCovers: Set<String> = []

    /// `fetchCovers` is false when the server couldn't be reached (and for goal changes): the summary still updates from
    /// what's on the device, and no sync waits on a download.
    static func refresh(store: LocalStore, books: [LibraryBook], goalMinutes: Int, fetchCovers: Bool,
                        coverURL: (LibraryBook) -> URL?) async {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroup.id) else { return }
        let now = Date()
        let shown = Array(LibraryFilter.readingNow(books).prefix(WidgetSummary.bookCount))

        for book in shown {
            let file = WidgetFiles.coverURL(bookId: book.bookId, in: container)
            guard fetchCovers, !FileManager.default.fileExists(atPath: file.path), let url = coverURL(book) else { continue }
            let key = "\(book.bookId)|\(url.absoluteString)"
            guard !failedCovers.contains(key) else { continue }
            guard let data = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 10)).0,
                  let jpeg = downscaled(data) else {
                failedCovers.insert(key)
                continue
            }
            try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? jpeg.write(to: file, options: .atomic)
        }
        let ids = Set(shown.map(\.bookId))
        WidgetFiles.removeCovers(except: ids, in: container)
        let withFile = ids.filter { FileManager.default.fileExists(atPath: WidgetFiles.coverURL(bookId: $0, in: container).path) }

        let since = Int64(now.addingTimeInterval(-401 * 86_400).timeIntervalSince1970 * 1000)
        let sessions = (try? store.sessions(endedAfter: since)) ?? []
        let summary = WidgetSummary.make(sessions: sessions, books: books, goalMinutes: goalMinutes, coverFiles: withFile,
                                         now: now, calendar: .current)
        try? WidgetFiles.write(summary, in: container)
        WidgetCenter.shared.reloadAllTimelines()
    }

    private static func downscaled(_ data: Data) -> Data? {
        guard let image = UIImage(data: data), image.size.width > 0 else { return nil }
        let scale = min(coverWidth / image.size.width, 1)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.8) { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
