// The Stacks server's API (src/server/app.ts). The app talks to nothing else.

import Foundation

public enum APIError: Error, Equatable, Sendable {
    /// No network, or the server can't be reached.
    case offline
    case server(status: Int, message: String)
    case decoding(String)
}

public protocol StacksAPI: Sendable {
    func library() async throws -> LibraryResponse
    /// nil when the server saved the edit but couldn't read the page back (Grimoire busy).
    func patch(bookId: String, _ patch: BookPatch) async throws -> LibraryBook?
    func sync(_ req: SyncRequest) async throws -> SyncResponse
    /// Every device's reading sessions that started at or after `from` (ms since epoch): the reading log.
    func sessions(from: Int64) async throws -> [Session]
    /// Uploads a book file; returns its bookId.
    func upload(file: URL, name: String) async throws -> String
    func fileURL(bookId: String) -> URL
    func coverURL(path: String) -> URL
}

private struct ServerError: Decodable { var error: String }

public struct HTTPStacksAPI: StacksAPI {
    public let baseURL: URL
    let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func library() async throws -> LibraryResponse {
        try await send(request("GET", "/api/library"))
    }

    public func patch(bookId: String, _ patch: BookPatch) async throws -> LibraryBook? {
        struct Answer: Decodable { var book: LibraryBook? }
        var req = request("PATCH", "/api/books/\(escape(bookId))")
        req.httpBody = try JSONEncoder().encode(patch)
        return (try await send(req) as Answer).book
    }

    public func sync(_ body: SyncRequest) async throws -> SyncResponse {
        var req = request("POST", "/api/sync")
        req.httpBody = try JSONEncoder().encode(body)
        return try await send(req)
    }

    public func sessions(from: Int64) async throws -> [Session] {
        struct Answer: Decodable { var sessions: [Session] }
        return (try await send(request("GET", "/api/sessions?from=\(from)")) as Answer).sessions
    }

    public func upload(file: URL, name: String) async throws -> String {
        struct Answer: Decodable { var bookId: String }
        var req = request("POST", "/api/books")
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        req.setValue(name.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(.init(charactersIn: "-._~"))), forHTTPHeaderField: "X-Filename")
        req.timeoutInterval = 600
        let (data, res) = try await call { try await session.upload(for: req, fromFile: file) }
        return (try decode(data, res) as Answer).bookId
    }

    public func fileURL(bookId: String) -> URL {
        baseURL.appendingPathComponent("api/books/\(bookId)/file")
    }

    public func coverURL(path: String) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL
    }

    // MARK: - plumbing

    private func escape(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    private func request(_ method: String, _ path: String) -> URLRequest {
        var req = URLRequest(url: URL(string: path, relativeTo: baseURL)!.absoluteURL)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 30
        return req
    }

    private func send<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, res) = try await call { try await session.data(for: req) }
        return try decode(data, res)
    }

    private func call(_ fn: () async throws -> (Data, URLResponse)) async throws -> (Data, URLResponse) {
        do {
            return try await fn()
        } catch let e as URLError {
            throw e.code == .cancelled ? e : APIError.offline
        }
    }

    private func decode<T: Decodable>(_ data: Data, _ res: URLResponse) throws -> T {
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data).error) ?? String(decoding: data, as: UTF8.self)
            throw APIError.server(status: status, message: message)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }
}
