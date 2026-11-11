// "Open in Stacks" from Files, Safari or Mail: copies the EPUB or PDF into the shared container and
// queues it for upload. The app sends it to the server on its next sync.

import StacksKit
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.067, blue: 0.125, alpha: 1)
        label.textColor = UIColor(red: 0.89, green: 0.91, blue: 0.95, alpha: 1)
        label.font = .preferredFont(forTextStyle: .headline)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.text = "Adding to Stacks…"
        label.frame = view.bounds.insetBy(dx: 24, dy: 24)
        label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(label)
        Task { await add() }
    }

    private func add() async {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        let types = [UTType.epub, UTType.pdf]
        guard let provider = providers.first(where: { p in types.contains { p.hasItemConformingToTypeIdentifier($0.identifier) } }),
              let type = types.first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) else {
            finish("Only EPUB and PDF files can be added.")
            return
        }
        do {
            let (path, name) = try await copy(provider, type: type)
            let store = try LocalStore(path: try Self.container().appendingPathComponent("stacks.sqlite").path)
            try store.enqueueUpload(path: path, name: name)
            finish("Added to Stacks. It uploads the next time Stacks syncs.")
        } catch {
            finish("Couldn't add this file: \(error.localizedDescription)")
        }
    }

    private static func container() throws -> URL {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppGroup.id) else {
            throw CocoaError(.fileNoSuchFile)
        }
        return url
    }

    private func copy(_ provider: NSItemProvider, type: UTType) async throws -> (String, String) {
        let uploads = try Self.container().appendingPathComponent("Uploads", isDirectory: true)
        try FileManager.default.createDirectory(at: uploads, withIntermediateDirectories: true)
        return try await withCheckedThrowingContinuation { cont in
            _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, error in
                guard let url else { return cont.resume(throwing: error ?? CocoaError(.fileReadUnknown)) }
                let name = url.lastPathComponent
                let dest = uploads.appendingPathComponent("\(UUID().uuidString)-\(name)")
                do {
                    try FileManager.default.copyItem(at: url, to: dest)
                    cont.resume(returning: (dest.path, name))
                } catch {
                    cont.resume(throwing: error)
                }
            }
        }
    }

    private func finish(_ message: String) {
        label.text = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
