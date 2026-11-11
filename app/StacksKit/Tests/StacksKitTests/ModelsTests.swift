import Foundation
import Testing
@testable import StacksKit

/// The JSON the server tests wrote from real responses (src/server/app.test.ts).
func fixture(_ name: String) throws -> Data {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../app-fixtures")
    return try Data(contentsOf: root.appendingPathComponent(name).standardizedFileURL)
}

func canonical(_ data: Data) throws -> String {
    let obj = try JSONSerialization.jsonObject(with: data)
    return String(decoding: try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]), as: UTF8.self)
}

@Test func libraryFixtureDecodesEveryField() throws {
    let lib = try JSONDecoder().decode(LibraryResponse.self, from: try fixture("library.json"))
    #expect(lib.cursor == 1)
    let dune = try #require(lib.books.first)
    #expect(dune.id == "b1")
    #expect(dune.pageTitle == "Dune (1965)")
    #expect(dune.name == "Dune")
    #expect(dune.status == .want)
    #expect(dune.author == "Frank Herbert")
    #expect(dune.year == 1965)
    #expect(dune.summary == "Spice.")
    #expect(dune.format == .epub)
    #expect(dune.fileSize == 100)
    #expect(dune.fileSha256 == "sha1")
    #expect(dune.coverUrl == "/api/books/b1/cover")
    #expect(dune.isbn == "9780441013593")
    #expect(dune.lookupState == "pending")
    #expect(dune.lastReadAt == nil)
    #expect(dune.pendingEdit == false)
}

@Test func syncFixtureRoundTrips() throws {
    struct Pair: Codable { var request: SyncRequest; var response: SyncResponse }
    let data = try fixture("sync.json")
    let pair = try JSONDecoder().decode(Pair.self, from: data)
    #expect(pair.request.annotations.first?.kind == .note)
    #expect(pair.request.annotations.first?.color == .yellow)
    #expect(pair.response.positions.count == 1)
    #expect(try canonical(try JSONEncoder().encode(pair)) == (try canonical(data)))
}

@Test func locatorWithUnknownKeysRoundTrips() throws {
    let json = ##"{"href":"c1.xhtml","locations":{"progression":0.5,"cssSelector":"#p3","x":[1,true,null]},"text":{"highlight":"hi"}}"##
    let value = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
    #expect(try canonical(try JSONEncoder().encode(value)) == (try canonical(Data(json.utf8))))
    #expect(value["href"]?.stringValue == "c1.xhtml")
}

@Test func annotationWithEmptyHrefIsNotPlaced() {
    var a = Annotation(annotationId: "a", bookId: "b", kind: .highlight, color: .yellow,
                       locator: .object(["href": .string(""), "text": .object(["highlight": .string("x")])]),
                       text: "x", note: nil, createdAt: 1, updatedAt: 1, deletedAt: nil, device: "apple-books", source: .appleBooks)
    #expect(!a.isPlaced)
    a.locator = .object(["href": .string("OEBPS/ch1.xhtml")])
    #expect(a.isPlaced)
    a.locator = .object([:])
    #expect(!a.isPlaced)
}

@Test func bookPatchEncodesSetAndClear() throws {
    let patch = BookPatch(status: .set(.done), rating: .clear, finished: .set("2026-10-20"))
    #expect(try canonical(try JSONEncoder().encode(patch)) == #"{"finished":"2026-10-20","rating":null,"status":"done"}"#)
}
