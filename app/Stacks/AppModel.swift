// The app's state: the library (from the local copy, refreshed from the server), filters, sync status,
// downloads, and the edits made here.

import Foundation
import Observation
import StacksKit
import UIKit

@Observable @MainActor
final class AppModel {
    /// The server address injected from .env at project generation (STACKS_SERVER_URL, see .env.example),
    /// else a server on this machine. Settings and the STACKS_SERVER environment variable override it.
    static let defaultServer: String = {
        let injected = Bundle.main.object(forInfoDictionaryKey: "StacksServerURL") as? String ?? ""
        return injected.isEmpty ? "http://localhost:8451" : injected
    }()

    let store: LocalStore
    private let supportDir: URL
    let device: String
    private(set) var api: StacksAPI
    private(set) var engine: SyncEngine
    private(set) var downloads: DownloadManager

    var library: LibraryResponse? {
        didSet {
            searchText = LibraryFilter.haystacks(library?.books ?? [])
            reshow()
        }
    }
    var filter = LibraryFilter() {
        didSet { reshow() }
    }
    /// The books that pass the filter, kept up to date by `reshow` so views don't refilter on every redraw.
    private(set) var shown: [LibraryBook] = []
    @ObservationIgnored private var searchText: [String: String] = [:]
    var selected: String?
    /// A book the reader should open as soon as its page shows (from a stacks://book link).
    var readRequest: String?
    var lastSynced: Date?
    var offline = false
    var syncError: String?
    var downloadProgress: (done: Int, total: Int)?
    /// A short message about a file opened with Stacks ("Added Dune…"), cleared after a few seconds.
    var notice: String?
    /// Bumped when highlights, notes or positions change, so views re-read the store.
    var revision = 0

    /// Minutes of reading that make a day count for the habit (the widget's streak and week).
    var goalMinutes: Int {
        didSet {
            try? store.setGoalMinutes(goalMinutes)
            Task { await refreshWidget() }
        }
    }

    var serverURL: String {
        didSet {
            try? store.setSetting("server", serverURL)
            rebuildClients()
        }
    }

    init() {
        let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroup.id)
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        supportDir = dir
        // swiftlint:disable:next force_try
        store = try! LocalStore(path: dir.appendingPathComponent("stacks.sqlite").path)
        let kind: String = switch UIDevice.current.userInterfaceIdiom {
        case .pad: "iPad"
        case .mac: "Mac"
        default: "iPhone"
        }
        device = (try? store.device(kind: kind)) ?? "\(kind)-0000"
        let server = ProcessInfo.processInfo.environment["STACKS_SERVER"] ?? (try? store.setting("server")) ?? Self.defaultServer
        serverURL = server
        goalMinutes = (try? store.goalMinutes()) ?? ReadingHabit.defaultGoalMinutes
        let api = HTTPStacksAPI(baseURL: URL(string: server) ?? URL(string: Self.defaultServer)!)
        self.api = api
        engine = SyncEngine(api: api, store: store, device: device)
        downloads = DownloadManager(api: api, store: store)
        library = try? store.library()
        searchText = LibraryFilter.haystacks(books)
        reshow()
    }

    private func rebuildClients() {
        guard let url = URL(string: serverURL) else { return }
        api = HTTPStacksAPI(baseURL: url)
        engine = SyncEngine(api: api, store: store, device: device)
        downloads = DownloadManager(api: api, store: store)
    }

    // MARK: - library

    var books: [LibraryBook] { library?.books ?? [] }
    var tags: [TagInfo] { library?.tags ?? [] }
    private func reshow() { shown = filter.apply(books, tags: tags, haystacks: searchText) }
    var readingNow: [LibraryBook] { LibraryFilter.readingNow(books) }
    var groups: [LibraryFilter.Group] { LibraryFilter.groups(tags) }

    func open(_ link: DeepLink) {
        switch link {
        case .library: break
        case .book(let id):
            selected = id
            readRequest = id
        }
    }

    func book(_ id: String?) -> LibraryBook? { books.first { $0.bookId == id } }

    func coverURL(_ book: LibraryBook) -> URL? { book.coverUrl.map { api.coverURL(path: $0) } }

    func groupOf(tag: String) -> String { tags.first { $0.title == tag }?.group ?? LibraryFilter.otherGroup }

    // MARK: - sync

    func sync(closing: String? = nil) async {
        let outcome = await engine.syncNow(closing: closing)
        apply(outcome)
        if case .synced = outcome { await refreshWidget(fetchCovers: true) } else { await refreshWidget() }
        revision += 1
        await startDownloads()
    }

    /// A file opened with Stacks (Open With, double-click): copied into the shared container and queued for upload to the server.
    func importFile(_ url: URL) async {
        let ext = url.pathExtension.lowercased()
        guard ext == "epub" || ext == "pdf" else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let uploads = supportDir.appendingPathComponent("Uploads", isDirectory: true)
            try FileManager.default.createDirectory(at: uploads, withIntermediateDirectories: true)
            let dest = uploads.appendingPathComponent("\(UUID().uuidString)-\(url.lastPathComponent)")
            try FileManager.default.copyItem(at: url, to: dest)
            try store.enqueueUpload(path: dest.path, name: url.lastPathComponent)
            say("Adding \(url.deletingPathExtension().lastPathComponent)…")
            await sync()
            say("Added \(url.deletingPathExtension().lastPathComponent)")
        } catch {
            say("Couldn't add this file: \(error.localizedDescription)")
        }
    }

    private func say(_ text: String) {
        notice = text
        Task {
            try? await Task.sleep(for: .seconds(6))
            if notice == text { notice = nil }
        }
    }

    func refreshWidget(fetchCovers: Bool = false) async {
        await WidgetBridge.refresh(store: store, books: books, goalMinutes: goalMinutes, fetchCovers: fetchCovers) { coverURL($0) }
    }

    private func apply(_ outcome: SyncOutcome) {
        switch outcome {
        case .synced(let at):
            lastSynced = at
            offline = false
            syncError = nil
        case .offline:
            offline = true
        case .failed(let message):
            syncError = message
        }
        if let lib = try? store.library() { library = lib }
    }

    private func startDownloads() async {
        let books = books
        await downloads.run(books: books) { done, total in
            Task { @MainActor in self.downloadProgress = done < total ? (done, total) : nil }
        }
    }

    func localFile(_ book: LibraryBook) -> URL? { downloads.localURL(for: book.bookId) }

    /// Downloading this book failed three times (a wrong file each time, or the book is gone).
    func couldNotDownload(_ book: LibraryBook) -> Bool {
        _ = revision
        return ((try? store.downloadFailures(bookId: book.bookId, sha: book.fileSha256)) ?? 0) >= DownloadPlanner.maxFailures
    }

    func retryDownload(_ book: LibraryBook) {
        try? store.clearDownloadFailures(bookId: book.bookId)
        revision += 1
        Task { await sync() }
    }

    // MARK: - edits (shown at once, queued, then synced)

    func edit(_ book: LibraryBook, _ patch: BookPatch, change: (inout LibraryBook) -> Void) {
        guard var lib = library, let i = lib.books.firstIndex(where: { $0.bookId == book.bookId }) else { return }
        change(&lib.books[i])
        lib.books[i].pendingEdit = true
        library = lib
        try? store.saveLibrary(lib)
        try? store.enqueueEdit(bookId: book.bookId, patch: patch)
        Task { await sync() }
    }

    func setStatus(_ book: LibraryBook, _ status: BookStatus) {
        var patch = BookPatch(status: .set(status))
        let today = Self.today()
        if status == .done && book.finished == nil { patch.finished = .set(today) }
        edit(book, patch) {
            $0.status = status
            if status == .done && $0.finished == nil { $0.finished = today }
        }
    }

    func setRating(_ book: LibraryBook, _ rating: Int?) {
        edit(book, BookPatch(rating: rating.map { .set($0) } ?? .clear)) { $0.rating = rating }
    }

    func setRec(_ book: LibraryBook, _ rec: String) {
        let r = rec.trimmingCharacters(in: .whitespacesAndNewlines)
        edit(book, BookPatch(rec: r.isEmpty ? .clear : .set(r))) { $0.rec = r.isEmpty ? nil : r }
    }

    func setTags(_ book: LibraryBook, _ tags: [String]) {
        edit(book, BookPatch(tags: tags)) { $0.tags = tags }
    }

    static func today() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    // MARK: - reading data

    func annotations(_ book: LibraryBook) -> [Annotation] {
        _ = revision
        return (try? store.annotations(bookId: book.bookId)) ?? []
    }

    func positions(_ book: LibraryBook) -> [Position] {
        _ = revision
        return (try? store.positions(bookId: book.bookId)) ?? []
    }
}
