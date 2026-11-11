import Foundation
import Testing
@testable import StacksKit

/// Answers requests from a handler and records them.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var req = request
        if req.httpBody == nil, let stream = req.httpBodyStream {
            stream.open()
            var data = Data()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buf, maxLength: buf.count); if n <= 0 { break }; data.append(buf, count: n) }
            stream.close()
            req.httpBody = data
        }
        StubProtocol.requests.append(req)
        do {
            let (status, body) = try StubProtocol.handler!(req)
            let res = HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: res, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}

@Suite(.serialized) struct APITests {
    let api: HTTPStacksAPI
    init() {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        api = HTTPStacksAPI(baseURL: URL(string: "https://server.test:8450")!, session: URLSession(configuration: config))
        StubProtocol.requests = []
    }

    @Test func libraryGETsApiLibrary() async throws {
        StubProtocol.handler = { _ in (200, try fixture("library.json")) }
        let lib = try await api.library()
        #expect(lib.books.count == 1)
        #expect(StubProtocol.requests.first?.url?.absoluteString == "https://server.test:8450/api/library")
        #expect(StubProtocol.requests.first?.httpMethod == "GET")
    }

    @Test func sessionsGETsApiSessionsFrom() async throws {
        StubProtocol.handler = { _ in (200, try JSONEncoder().encode(["sessions": [ses("s1")]])) }
        let sessions = try await api.sessions(from: 1234)
        #expect(sessions == [ses("s1")])
        let req = try #require(StubProtocol.requests.first)
        #expect(req.httpMethod == "GET")
        #expect(req.url?.path == "/api/sessions")
        #expect(req.url?.query == "from=1234")
    }

    @Test func patchSendsOnlySetFieldsAndNullForClear() async throws {
        let book = try JSONDecoder().decode(LibraryResponse.self, from: try fixture("library.json")).books[0]
        StubProtocol.handler = { _ in (200, try JSONEncoder().encode(["book": book])) }
        _ = try await api.patch(bookId: "b1", BookPatch(status: .set(.done), rating: .clear))
        let req = try #require(StubProtocol.requests.first)
        #expect(req.httpMethod == "PATCH")
        #expect(req.url?.path == "/api/books/b1")
        #expect(try canonical(req.httpBody!) == #"{"rating":null,"status":"done"}"#)
    }

    @Test func syncPOSTsJSON() async throws {
        StubProtocol.handler = { _ in (200, Data(#"{"cursor":7,"positions":[],"sessions":[],"annotations":[]}"#.utf8)) }
        let res = try await api.sync(SyncRequest(device: "iPhone-1a2b", since: 3, positions: [], sessions: [], annotations: []))
        #expect(res.cursor == 7)
        let req = try #require(StubProtocol.requests.first)
        #expect(req.httpMethod == "POST")
        #expect(req.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }

    @Test func uploadSendsTheFileNameURIEncoded() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("up-\(UUID()).epub")
        try Data("PK".utf8).write(to: file)
        StubProtocol.handler = { _ in (201, Data(#"{"bookId":"nb","created":true,"pageTitle":"Cien años"}"#.utf8)) }
        #expect(try await api.upload(file: file, name: "Cien años.epub") == "nb")
        #expect(StubProtocol.requests.first?.value(forHTTPHeaderField: "X-Filename") == "Cien%20a%C3%B1os.epub")
    }

    @Test func a400BecomesServerErrorWithTheMessage() async throws {
        StubProtocol.handler = { _ in (400, Data(#"{"error":"rating must be a whole number from 1 to 5, or null"}"#.utf8)) }
        await #expect(throws: APIError.server(status: 400, message: "rating must be a whole number from 1 to 5, or null")) {
            _ = try await api.patch(bookId: "b1", BookPatch(rating: .set(9)))
        }
    }

    @Test func noNetworkBecomesOffline() async throws {
        StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: APIError.offline) { _ = try await api.library() }
    }

    @Test func fileAndCoverURLs() {
        #expect(api.fileURL(bookId: "b1").absoluteString == "https://server.test:8450/api/books/b1/file")
        #expect(api.coverURL(path: "/api/books/b1/cover").absoluteString == "https://server.test:8450/api/books/b1/cover")
    }
}
