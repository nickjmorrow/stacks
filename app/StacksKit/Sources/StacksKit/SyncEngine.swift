// Sends what this device has queued (uploads, edits, positions, sessions, highlights and notes) and
// takes in what other devices did since the last sync. Safe to call often; one run at a time.

import Foundation

public enum SyncOutcome: Equatable, Sendable {
    case synced(Date)
    case offline
    case failed(String)
}

public actor SyncEngine {
    let api: StacksAPI
    let store: LocalStore
    let device: String
    let clock: @Sendable () -> Date
    /// Records per list in one request.
    static let batch = 1000
    /// How far back the reading log is pulled (ms): a year.
    static let sessionHistory: Int64 = 365 * 86_400_000
    static let backfilledKey = "sessionsBackfilled"
    private var running: Task<SyncOutcome, Never>?
    /// The last edit the server refused, for the UI to show.
    public private(set) var lastRefusal: String?

    public init(api: StacksAPI, store: LocalStore, device: String, clock: @escaping @Sendable () -> Date = Date.init) {
        self.api = api
        self.store = store
        self.device = device
        self.clock = clock
    }

    /// A call while a sync is running waits for that one and returns its outcome.
    /// `closing`: the book just closed, so the server writes its progress.
    public func syncNow(closing: String? = nil) async -> SyncOutcome {
        if let running {
            _ = await running.value
            if closing == nil { return await running.value }
        }
        let task = Task { await self.run(closing: closing) }
        running = task
        let outcome = await task.value
        running = nil
        return outcome
    }

    public func refreshLibrary() async -> SyncOutcome {
        do {
            var lib = try await api.library()
            // Edits that haven't reached the server yet stay as they were made.
            for edit in try store.pendingEdits() {
                guard let i = lib.books.firstIndex(where: { $0.bookId == edit.bookId }) else { continue }
                Self.apply(edit.patch, to: &lib.books[i])
            }
            try store.saveLibrary(lib)
            return .synced(clock())
        } catch {
            return outcome(error)
        }
    }

    static func apply(_ p: BookPatch, to b: inout LibraryBook) {
        switch p.status { case .set(let v): b.status = v; case .clear, .unchanged: break }
        switch p.rating { case .set(let v): b.rating = v; case .clear: b.rating = nil; case .unchanged: break }
        switch p.rec { case .set(let v): b.rec = v; case .clear: b.rec = nil; case .unchanged: break }
        switch p.finished { case .set(let v): b.finished = v; case .clear: b.finished = nil; case .unchanged: break }
        if let tags = p.tags { b.tags = tags }
        b.pendingEdit = true
    }

    private func run(closing: String?) async -> SyncOutcome {
        do {
            try await sendUploads()
            try await sendEdits()
            try await exchange(closing: closing)
        } catch {
            return outcome(error)
        }
        await pullSessions()
        return await refreshLibrary()
    }

    /// Once per install: the past year of every device's reading sessions, for the habit widget. After that the
    /// sessions arrive in each sync response (by cursor). Not worth failing a sync over: it is tried again next time.
    private func pullSessions() async {
        let done = (try? store.setting(Self.backfilledKey)) ?? nil
        guard done == nil else { return }
        guard let sessions = try? await api.sessions(from: ms(clock()) - Self.sessionHistory) else { return }
        for s in sessions { _ = try? store.putSession(s, dirty: false) }
        try? store.setSetting(Self.backfilledKey, "1")
    }

    private func outcome(_ error: Error) -> SyncOutcome {
        if let e = error as? APIError, e == .offline { return .offline }
        return .failed(String(describing: error))
    }

    private func sendUploads() async throws {
        for up in try store.pendingUploads() {
            let url = URL(fileURLWithPath: up.path)
            guard FileManager.default.fileExists(atPath: up.path) else {
                try store.removeUpload(id: up.id)
                continue
            }
            do {
                _ = try await api.upload(file: url, name: up.name)
            } catch APIError.server(let status, let message) where (400..<500).contains(status) {
                lastRefusal = "\(up.name): \(message)" // never accepted (not a book, too big, already has a file): drop it
            } catch APIError.offline {
                throw APIError.offline
            } catch {
                continue // try again next sync; don't hold up the rest
            }
            try store.removeUpload(id: up.id)
            try? FileManager.default.removeItem(at: url)
        }
    }

    /// Edits go in order. One the server refuses (4xx) is dropped; any other problem leaves it and the
    /// edits after it for the next sync, without holding up positions and highlights.
    private func sendEdits() async throws {
        for edit in try store.pendingEdits() {
            do {
                _ = try await api.patch(bookId: edit.bookId, edit.patch)
            } catch APIError.server(let status, let message) where (400..<500).contains(status) {
                lastRefusal = message
            } catch APIError.offline {
                throw APIError.offline
            } catch {
                return
            }
            try store.removeEdit(id: edit.id)
        }
    }

    private func exchange(closing: String?) async throws {
        var closing = closing
        repeat {
            let positions = try store.dirtyPositions(limit: Self.batch)
            let sessions = try store.dirtySessions(limit: Self.batch)
            let annotations = try store.dirtyAnnotations(limit: Self.batch)
            do {
                try await send(positions: positions, sessions: sessions, annotations: annotations, closing: closing)
                closing = nil
            } catch APIError.server(let status, _) where status == 400 {
                // Some record in the batch is refused: send them one at a time and set aside the ones refused.
                for p in positions { try await sendAlone(positions: [p]) }
                for s in sessions { try await sendAlone(sessions: [s]) }
                for a in annotations { try await sendAlone(annotations: [a]) }
                if let c = closing { try await send(positions: [], sessions: [], annotations: [], closing: c); closing = nil }
            }
            if positions.count < Self.batch && sessions.count < Self.batch && annotations.count < Self.batch { break }
        } while true
    }

    private func sendAlone(positions: [Position] = [], sessions: [Session] = [], annotations: [Annotation] = []) async throws {
        do {
            try await send(positions: positions, sessions: sessions, annotations: annotations)
        } catch APIError.server(let status, let message) where status == 400 {
            lastRefusal = message
            try store.markSent(positions: positions) // refused for good: stop resending it
            try store.markSent(sessions: sessions)
            try store.markSent(annotations: annotations)
        }
    }

    private func send(positions: [Position], sessions: [Session], annotations: [Annotation], closing: String? = nil) async throws {
        let req = SyncRequest(device: device, since: try store.cursor(), positions: positions, sessions: sessions,
                              annotations: annotations, closing: closing)
        let res = try await api.sync(req)
        try store.markSent(positions: positions)
        try store.markSent(sessions: sessions)
        try store.markSent(annotations: annotations)
        for p in res.positions where p.device != device { try store.putPosition(p, dirty: false) }
        for a in res.annotations { try store.putAnnotation(a, dirty: false) }
        for s in res.sessions { try store.putSession(s, dirty: false) } // other devices' reading; ours come back equal and are ignored
        try store.setCursor(res.cursor)
    }
}
