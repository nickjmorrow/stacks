import Foundation
import Testing
@testable import StacksKit

func pos(_ book: String = "b1", device: String = "iPhone-1a2b", p: Double = 0.2, at: Int64 = 100) -> Position {
    Position(bookId: book, device: device, locator: .object(["href": .string("c1.xhtml")]), progression: p, updatedAt: at)
}

func ses(_ id: String = "s1", end: Int64 = 200) -> Session {
    Session(sessionId: id, bookId: "b1", device: "iPhone-1a2b", startedAt: 100, endedAt: end, activeSeconds: 60,
            startProgression: 0.1, endProgression: 0.2, pagesTurned: 3)
}

func ann(_ id: String = "a1", note: String? = nil, at: Int64 = 100, deleted: Int64? = nil) -> Annotation {
    Annotation(annotationId: id, bookId: "b1", kind: note == nil ? .highlight : .note, color: .yellow,
               locator: .object(["href": .string("c1.xhtml")]), text: "x", note: note, createdAt: 100, updatedAt: at,
               deletedAt: deleted, device: "iPhone-1a2b", source: .stacks)
}

@Suite struct LocalStoreTests {
    let store = try! LocalStore(path: nil)

    @Test func libraryRoundTrips() throws {
        let lib = try JSONDecoder().decode(LibraryResponse.self, from: try fixture("library.json"))
        try store.saveLibrary(lib)
        #expect(try store.library() == lib)
    }

    @Test func deviceNameIsMadeOnceAndKeptAcrossReopen() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("stacks-\(UUID()).sqlite").path
        let first = try LocalStore(path: path).device(kind: "iPhone")
        #expect(first.hasPrefix("iPhone-") && first.count == 11)
        #expect(try LocalStore(path: path).device(kind: "iPhone") == first)
    }

    @Test func cursorIsStored() throws {
        #expect(try store.cursor() == 0)
        try store.setCursor(42)
        #expect(try store.cursor() == 42)
    }

    @Test func dirtyPositionsAreSentThenCleared() throws {
        try store.putPosition(pos(), dirty: true)
        #expect(try store.dirtyPositions(limit: 10) == [pos()])
        try store.markSent(positions: [pos()])
        #expect(try store.dirtyPositions(limit: 10).isEmpty)
        #expect(try store.position(bookId: "b1", device: "iPhone-1a2b") == pos())
    }

    @Test func markSentLeavesARowChangedAfterSendingDirty() throws {
        try store.putPosition(pos(), dirty: true)
        let sent = try store.dirtyPositions(limit: 10)
        try store.putPosition(pos(p: 0.3, at: 150), dirty: true)
        try store.markSent(positions: sent)
        #expect(try store.dirtyPositions(limit: 10) == [pos(p: 0.3, at: 150)])
    }

    @Test func anOlderPositionFromAnotherDeviceDoesNotReplaceANewerOne() throws {
        try store.putPosition(pos(device: "iPad-9f9f", at: 300), dirty: false)
        try store.putPosition(pos(device: "iPad-9f9f", p: 0.1, at: 200), dirty: false)
        #expect(try store.positions(bookId: "b1").map(\.updatedAt) == [300])
    }

    @Test func sessionsGrowAndAreSent() throws {
        try store.putSession(ses(), dirty: true)
        try store.putSession(ses(end: 400), dirty: true)
        #expect(try store.dirtySessions(limit: 10) == [ses(end: 400)])
        try store.markSent(sessions: [ses(end: 400)])
        #expect(try store.dirtySessions(limit: 10).isEmpty)
    }

    @Test func anAnnotationWithAnEqualTimeIsIgnoredAndANewerOneApplied() throws {
        try store.putAnnotation(ann(), dirty: false)
        try store.putAnnotation(ann(note: "later?", at: 100), dirty: false)
        #expect(try store.annotations(bookId: "b1").first?.note == nil)
        try store.putAnnotation(ann(note: "yes", at: 101), dirty: true)
        #expect(try store.annotations(bookId: "b1").first?.note == "yes")
        #expect(try store.dirtyAnnotations(limit: 10).count == 1)
    }

    @Test func deletedAnnotationsAreHiddenButStillSent() throws {
        try store.putAnnotation(ann(at: 200, deleted: 200), dirty: true)
        #expect(try store.annotations(bookId: "b1").isEmpty)
        #expect(try store.dirtyAnnotations(limit: 10).count == 1)
    }

    @Test func editsAndUploadsQueueInOrder() throws {
        try store.enqueueEdit(bookId: "b1", patch: BookPatch(status: .set(.doing)))
        try store.enqueueEdit(bookId: "b1", patch: BookPatch(status: .set(.done)))
        let edits = try store.pendingEdits()
        #expect(edits.map(\.patch.status) == [.set(.doing), .set(.done)])
        try store.removeEdit(id: edits[0].id)
        #expect(try store.pendingEdits().count == 1)
        try store.enqueueUpload(path: "/tmp/x.epub", name: "x.epub")
        let ups = try store.pendingUploads()
        #expect(ups.map(\.name) == ["x.epub"])
        try store.removeUpload(id: ups[0].id)
        #expect(try store.pendingUploads().isEmpty)
    }

    @Test func localFilesAndDownloadFailures() throws {
        #expect(try store.localFile(bookId: "b1") == nil)
        try store.setLocalFile(bookId: "b1", path: "Books/b1.epub", sha: "abc")
        #expect(try store.localFile(bookId: "b1")?.sha == "abc")
        try store.noteDownloadFailure(bookId: "b2", sha: "x")
        try store.noteDownloadFailure(bookId: "b2", sha: "x")
        #expect(try store.downloadFailures(bookId: "b2", sha: "x") == 2)
    }

    @Test func settingsAreKept() throws {
        #expect(try store.setting("theme") == nil)
        try store.setSetting("theme", "paper")
        #expect(try store.setting("theme") == "paper")
    }

    @Test func sessionsEndedAfterReturnsOnlyLaterOnesOldestFirst() throws {
        try store.putSession(ses("old", end: 100), dirty: false)
        try store.putSession(ses("b", end: 500), dirty: false)
        try store.putSession(ses("a", end: 300), dirty: true)
        #expect(try store.sessions(endedAfter: 100).map(\.sessionId) == ["a", "b"])
        #expect(try store.sessions(endedAfter: 500).isEmpty)
    }

    @Test func goalDefaultsToFive() throws {
        #expect(try store.goalMinutes() == 5)
    }

    @Test func goalIsStoredAndClamped() throws {
        try store.setGoalMinutes(15)
        #expect(try store.goalMinutes() == 15)
        try store.setGoalMinutes(0)
        #expect(try store.goalMinutes() == 1)
        try store.setGoalMinutes(500)
        #expect(try store.goalMinutes() == 120)
    }
}
