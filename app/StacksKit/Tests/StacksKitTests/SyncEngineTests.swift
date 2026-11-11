import Foundation
import Testing
@testable import StacksKit

final class FakeAPI: StacksAPI, @unchecked Sendable {
    let lock = NSLock()
    var offline = false
    var syncs: [SyncRequest] = []
    var patches: [(String, BookPatch)] = []
    var uploads: [String] = []
    /// nil answers 400 (the server rejecting the request).
    var answer: (SyncRequest) -> SyncResponse? = { req in SyncResponse(cursor: req.since + 1) }
    var uploadError: APIError?
    var patchError: APIError?
    var library = LibraryResponse(books: [], tags: [], cursor: 0)
    var remoteSessions: [Session] = []
    var sessionsError: APIError?
    var sessionsFrom: [Int64] = []

    func library() async throws -> LibraryResponse {
        try lock.withLock { if offline { throw APIError.offline }; return library }
    }
    func patch(bookId: String, _ patch: BookPatch) async throws -> LibraryBook? {
        try lock.withLock {
            if offline { throw APIError.offline }
            if let patchError { throw patchError }
            patches.append((bookId, patch))
        }
        return book("b1", "Dune")
    }
    func sync(_ req: SyncRequest) async throws -> SyncResponse {
        try lock.withLock {
            if offline { throw APIError.offline }
            guard let res = answer(req) else { throw APIError.server(status: 400, message: "bad record") }
            syncs.append(req)
            return res
        }
    }
    func upload(file: URL, name: String) async throws -> String {
        try lock.withLock {
            if offline { throw APIError.offline }
            if let uploadError { throw uploadError }
            uploads.append(name)
            return "nb"
        }
    }
    func sessions(from: Int64) async throws -> [Session] {
        try lock.withLock {
            if offline { throw APIError.offline }
            sessionsFrom.append(from)
            if let sessionsError { throw sessionsError }
            return remoteSessions
        }
    }
    func fileURL(bookId: String) -> URL { URL(string: "https://server.test/api/books/\(bookId)/file")! }
    func coverURL(path: String) -> URL { URL(string: "https://server.test\(path)")! }
}

@Suite struct SyncEngineTests {
    let store = try! LocalStore(path: nil)
    let api = FakeAPI()
    var engine: SyncEngine { SyncEngine(api: api, store: store, device: "iPhone-1a2b") }

    @Test func pullsOtherDevicesSessionsAfterSyncing() async throws {
        var ipad = ses("s9")
        ipad.device = "iPad-2"
        api.remoteSessions = [ipad]
        _ = await engine.syncNow()
        #expect(try store.sessions(endedAfter: 0).map(\.sessionId) == ["s9"])
        #expect(try store.dirtySessions(limit: 10).isEmpty) // never sent back
    }

    @Test func asksForTheLastYearOfSessions() async throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        _ = await SyncEngine(api: api, store: store, device: "iPhone-1a2b", clock: { now }).syncNow()
        #expect(api.sessionsFrom == [ms(now) - 365 * 86_400_000])
    }

    @Test func aFailedSessionPullDoesNotFailTheSync() async throws {
        api.sessionsError = .server(status: 500, message: "boom")
        let outcome = await engine.syncNow()
        guard case .synced = outcome else { Issue.record("\(outcome)"); return }
    }

    @Test func aSessionAlreadyStoredLocallyIsNeitherDuplicatedNorMarkedDirty() async throws {
        try store.putSession(ses("s1"), dirty: false)
        api.remoteSessions = [ses("s1")]
        _ = await engine.syncNow()
        #expect(try store.sessions(endedAfter: 0).count == 1)
        #expect(try store.dirtySessions(limit: 10).isEmpty)
    }

    @Test func thePastYearIsPulledOnlyOnce() async throws {
        _ = await engine.syncNow()
        _ = await engine.syncNow()
        #expect(api.sessionsFrom.count == 1)
    }

    @Test func aFailedYearPullIsTriedAgainNextSync() async throws {
        api.sessionsError = .server(status: 500, message: "boom")
        _ = await engine.syncNow()
        api.sessionsError = nil
        var ipad = ses("s9")
        ipad.device = "iPad-2"
        api.remoteSessions = [ipad]
        _ = await engine.syncNow()
        #expect(api.sessionsFrom.count == 2)
        #expect(try store.sessions(endedAfter: 0).map(\.sessionId) == ["s9"])
    }

    @Test func sessionsInTheSyncResponseAreStoredAndNotSentBack() async throws {
        var ipad = ses("s7")
        ipad.device = "iPad-2"
        api.answer = { req in SyncResponse(cursor: req.since + 1, sessions: [ipad]) }
        _ = await engine.syncNow()
        #expect(try store.sessions(endedAfter: 0).map(\.sessionId) == ["s7"])
        #expect(try store.dirtySessions(limit: 10).isEmpty)
    }

    @Test func sendsDirtyRecordsAndClearsThem() async throws {
        try store.putPosition(pos(), dirty: true)
        try store.putSession(ses(), dirty: true)
        try store.putAnnotation(ann(), dirty: true)
        let outcome = await engine.syncNow()
        guard case .synced = outcome else { Issue.record("\(outcome)"); return }
        #expect(api.syncs.count == 1)
        #expect(api.syncs[0].positions == [pos()])
        #expect(api.syncs[0].sessions == [ses()])
        #expect(api.syncs[0].annotations == [ann()])
        #expect(try store.dirtyPositions(limit: 10).isEmpty)
        #expect(try store.dirtySessions(limit: 10).isEmpty)
        #expect(try store.dirtyAnnotations(limit: 10).isEmpty)
    }

    @Test func manyQueuedPositionsGoInBatchesOfAThousandInOrder() async throws {
        for i in 0..<2500 { try store.putPosition(pos("b\(i)", at: Int64(1000 + i)), dirty: true) }
        _ = await engine.syncNow()
        #expect(api.syncs.map(\.positions.count) == [1000, 1000, 500])
        #expect(api.syncs[0].positions.first?.bookId == "b0")
        #expect(api.syncs[2].positions.last?.bookId == "b2499")
        #expect(try store.dirtyPositions(limit: 5000).isEmpty)
    }

    @Test func offlineKeepsEverythingQueued() async throws {
        api.offline = true
        try store.putPosition(pos(), dirty: true)
        try store.enqueueEdit(bookId: "b1", patch: BookPatch(status: .set(.done)))
        #expect(await engine.syncNow() == .offline)
        #expect(try store.dirtyPositions(limit: 10).count == 1)
        #expect(try store.pendingEdits().count == 1)
    }

    @Test func aRejectedEditIsDroppedAndTheRestContinue() async throws {
        api.patchError = .server(status: 400, message: "rating must be a whole number from 1 to 5, or null")
        try store.enqueueEdit(bookId: "b1", patch: BookPatch(rating: .set(9)))
        let outcome = await engine.syncNow()
        guard case .synced = outcome else { Issue.record("\(outcome)"); return }
        #expect(try store.pendingEdits().isEmpty)
        #expect(api.syncs.count == 1)
    }

    @Test func editsAreSentInOrderBeforeTheSync() async throws {
        try store.enqueueEdit(bookId: "b1", patch: BookPatch(status: .set(.doing)))
        try store.enqueueEdit(bookId: "b1", patch: BookPatch(status: .set(.done)))
        _ = await engine.syncNow()
        #expect(api.patches.map(\.1.status) == [.set(.doing), .set(.done)])
        #expect(try store.pendingEdits().isEmpty)
    }

    @Test func incomingAnnotationsFollowTheNewerRule() async throws {
        try store.putAnnotation(ann(note: "mine, newer", at: 300), dirty: false)
        api.answer = { req in SyncResponse(cursor: 9, annotations: [ann(note: "theirs, older", at: 200), ann("a2", note: "new one", at: 50)]) }
        _ = await engine.syncNow()
        let notes = try store.annotations(bookId: "b1").map(\.note)
        #expect(notes.contains("mine, newer"))
        #expect(notes.contains("new one"))
        #expect(!notes.contains("theirs, older"))
    }

    @Test func otherDevicesPositionsAreStoredCleanAndTheCursorKept() async throws {
        api.answer = { _ in SyncResponse(cursor: 77, positions: [pos(device: "iPad-9f9f", p: 0.6, at: 500)]) }
        _ = await engine.syncNow()
        #expect(try store.positions(bookId: "b1").map(\.device) == ["iPad-9f9f"])
        #expect(try store.dirtyPositions(limit: 10).isEmpty)
        #expect(try store.cursor() == 77)
    }

    @Test func uploadsGoFirstAndAreRemoved() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("u-\(UUID()).epub")
        try Data("PK".utf8).write(to: file)
        try store.enqueueUpload(path: file.path, name: "New.epub")
        _ = await engine.syncNow()
        #expect(api.uploads == ["New.epub"])
        #expect(try store.pendingUploads().isEmpty)
    }

    @Test func refreshLibrarySavesIt() async throws {
        api.library = try JSONDecoder().decode(LibraryResponse.self, from: try fixture("library.json"))
        _ = await engine.refreshLibrary()
        #expect(try store.library()?.books.count == 1)
    }
}
