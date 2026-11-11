import Foundation
import Testing
@testable import StacksKit

// C1: only a wrong file or a book gone from the server counts as a failed download.
@Test func onlyShaMismatchesAndMissingBooksCountAsDownloadFailures() {
    #expect(DownloadFailure.counts(status: 200, shaMatches: false))
    #expect(DownloadFailure.counts(status: 404, shaMatches: nil))
    #expect(!DownloadFailure.counts(status: 502, shaMatches: nil))
    #expect(!DownloadFailure.counts(status: nil, shaMatches: nil)) // no answer at all: offline, DNS, TLS
}

@Test func failuresAreForgottenWhenTheServerHasANewFile() throws {
    let store = try LocalStore(path: nil)
    for _ in 0..<3 { try store.noteDownloadFailure(bookId: "b1", sha: "old") }
    #expect(try store.downloadFailures(bookId: "b1", sha: "old") == 3)
    #expect(try store.downloadFailures(bookId: "b1", sha: "new") == 0)
    try store.clearDownloadFailures(bookId: "b1")
    #expect(try store.downloadFailures(bookId: "b1", sha: "old") == 0)
}

// C2: a rejected upload is dropped; a failing edit doesn't stop positions syncing; a bad record doesn't block the rest.
@Suite struct SyncFixTests {
    let store = try! LocalStore(path: nil)
    let api = FakeAPI()
    var engine: SyncEngine { SyncEngine(api: api, store: store, device: "iPhone-1a2b") }

    @Test func aRejectedUploadIsDroppedAndSyncContinues() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("u-\(UUID()).txt")
        try Data("x".utf8).write(to: file)
        api.uploadError = .server(status: 415, message: "not an EPUB or PDF")
        try store.enqueueUpload(path: file.path, name: "notes.txt")
        try store.putPosition(pos(), dirty: true)
        let e = engine
        let outcome = await e.syncNow()
        guard case .synced = outcome else { Issue.record("\(outcome)"); return }
        #expect(try store.pendingUploads().isEmpty)
        #expect(api.syncs.count == 1)
        #expect(await e.lastRefusal == "notes.txt: not an EPUB or PDF")
    }

    @Test func aServerErrorOnAnEditKeepsItButPositionsStillSync() async throws {
        api.patchError = .server(status: 500, message: "boom")
        try store.enqueueEdit(bookId: "b1", patch: BookPatch(status: .set(.done)))
        try store.putPosition(pos(), dirty: true)
        _ = await engine.syncNow()
        #expect(try store.pendingEdits().count == 1)
        #expect(api.syncs.first?.positions == [pos()])
        #expect(try store.dirtyPositions(limit: 10).isEmpty)
    }

    @Test func aBatchTheServerRejectsIsRetriedRecordByRecordAndTheBadOneSetAside() async throws {
        api.answer = { req in
            if req.annotations.contains(where: { $0.text == "bad" }) { return nil }
            return SyncResponse(cursor: req.since + 1)
        }
        try store.putAnnotation(ann("a1"), dirty: true)
        var bad = ann("a2", at: 101)
        bad.text = "bad"
        try store.putAnnotation(bad, dirty: true)
        try store.putPosition(pos(), dirty: true)
        let outcome = await engine.syncNow()
        guard case .synced = outcome else { Issue.record("\(outcome)"); return }
        #expect(try store.dirtyAnnotations(limit: 10).isEmpty)
        #expect(try store.dirtyPositions(limit: 10).isEmpty)
        #expect(api.syncs.flatMap(\.annotations).map(\.annotationId).contains("a1"))
    }

    // I1: an edit still waiting is shown over the server's older library.
    @Test func refreshKeepsEditsThatHaveNotReachedTheServer() async throws {
        var lib = try JSONDecoder().decode(LibraryResponse.self, from: try fixture("library.json"))
        lib.books[0].rating = 3
        api.library = lib
        try store.enqueueEdit(bookId: "b1", patch: BookPatch(rating: .set(4), tags: ["Gothic"]))
        _ = await engine.refreshLibrary()
        let b = try #require(try store.library()?.books.first)
        #expect(b.rating == 4)
        #expect(b.tags == ["Gothic"])
        #expect(b.pendingEdit)
    }
}

// I5: Apple Books' imported position is only used until Stacks has one of its own.
@Test func theImportedApplePositionIsIgnoredOnceStacksHasOne() {
    let apple = pos(device: "apple-books", p: 0.62, at: 50)
    let mine = pos(device: "iPhone-1a2b", p: 0.40, at: 100)
    #expect(PositionPolicy.open(all: [apple]).start == apple)
    let r = PositionPolicy.open(all: [apple, mine])
    #expect(r.start == mine)
    #expect(r.offer == nil)
}

// C2: a locator too big for the server (16 KB) is cut down before it's saved.
@Test func anOversizedLocatorIsTrimmed() {
    let long = String(repeating: "word ", count: 5000)
    let loc = JSONValue.object(["href": .string("c1.xhtml"), "text": .object([
        "before": .string(long), "highlight": .string(long), "after": .string(long)])])
    let fitted = LocatorFit.fit(loc)
    #expect(fitted.jsonString().utf8.count <= 15_000)
    #expect(fitted["href"]?.stringValue == "c1.xhtml")
    #expect(fitted["text"]?["highlight"]?.stringValue?.hasPrefix("word word") == true)
    let small = JSONValue.object(["href": .string("c1.xhtml")])
    #expect(LocatorFit.fit(small) == small)
}

@Test func closingABookSendsItsIdOnce() async throws {
    let store = try LocalStore(path: nil)
    let api = FakeAPI()
    let engine = SyncEngine(api: api, store: store, device: "iPhone-1a2b")
    try store.putPosition(pos(), dirty: true)
    _ = await engine.syncNow(closing: "b1")
    _ = await engine.syncNow()
    #expect(api.syncs.map(\.closing) == ["b1", nil])
}
