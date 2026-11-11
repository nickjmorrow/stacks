// Scroll mode for reflowable EPUBs: the whole book as one long page, chapter after chapter, the way
// Apple Books scrolls. Readium shows one chapter at a time and can't flow them together, so this view
// loads every chapter into one web page itself (ScrollReader.js does the page side). Positions,
// highlights and notes are Readium locators, so page mode and the other devices read them as their own.

import UIKit
import WebKit
import os
import StacksKit
import ReadiumShared

@MainActor
final class ScrollReaderController: UIViewController, BookReader, WKNavigationDelegate {
    var onLocation: ((ReadiumShared.Locator) -> Void)?
    var onTap: (() -> Void)?
    var onAnnotate: ((ReadiumShared.Locator, String, AnnotationKind, String?) -> Void)?
    var onAnnotationTapped: ((String) -> Void)?

    private let publication: Publication
    private let chapters: [ReadiumShared.Link]
    private var settings: ReaderSettings
    private var dark: Bool
    private var pendingLocation: ReadiumShared.Locator?
    private var pendingAnnotations: [Annotation] = []
    private var isLoaded = false
    /// Per chapter: its first position number, how many positions it has, and where it starts and ends
    /// in the whole book (0...1), from Readium's positions, so progress matches page mode's.
    private var chapterSpans: [(first: Int, count: Int, start: Double, end: Double)] = []
    private let webView: WKWebView
    private let files: BookFileServer
    private let log = Logger(subsystem: "com.nicholai.stacks", category: "scroll-reader")

    init(publication: Publication, initialLocation: ReadiumShared.Locator?, settings: ReaderSettings, dark: Bool) {
        self.publication = publication
        chapters = publication.readingOrder
        self.settings = settings
        self.dark = dark
        pendingLocation = initialLocation
        files = BookFileServer(publication: publication)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(files, forURLScheme: BookFileServer.scheme)
        config.dataDetectorTypes = []
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(nibName: nil, bundle: nil)
        let messages = WeakMessageHandler(self)
        for name in ["location", "tap", "annotationTapped", "external"] {
            config.userContentController.add(messages, name: name)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        let background = UIColor(hex: settings.tokens(dark: dark).background)
        view.backgroundColor = background
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = self
        webView.alpha = 0 // shown once it's at the right spot, so it doesn't flash the book's start
        webView.frame = view.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)
        files.shell = shellHTML()
        webView.load(URLRequest(url: BookFileServer.url("app/shell.html")))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { await loadBook() }
    }

    private func loadBook() async {
        // Readium's Publication isn't Sendable; it's only read here, on the main actor.
        nonisolated(unsafe) let publication = publication
        if case .success(let byChapter) = await publication.positionsByReadingOrder() {
            chapterSpans = Self.spans(byChapter)
        }
        let list = chapters.map { ["url": BookFileServer.url("book/" + $0.url().string).absoluteString] }
        _ = try? await webView.callAsyncJavaScript("await stacks.load(chapters)", arguments: ["chapters": list], contentWorld: .page)
        isLoaded = true
        apply(settings: settings, dark: dark)
        show(annotations: pendingAnnotations)
        if let pendingLocation { await go(to: pendingLocation) } else { await goTo(index: 0, progression: 0) }
        pendingLocation = nil
        UIView.animate(withDuration: 0.15) { self.webView.alpha = 1 }
    }

    static func spans(_ byChapter: [[ReadiumShared.Locator]]) -> [(first: Int, count: Int, start: Double, end: Double)] {
        let starts = byChapter.map { $0.first?.locations.totalProgression }
        return byChapter.enumerated().map { i, positions in
            let start = starts[i] ?? (i == 0 ? 0 : 1)
            let end = starts[(i + 1)...].compactMap { $0 }.first ?? 1
            return (positions.first?.locations.position ?? 1, max(positions.count, 1), start, end)
        }
    }

    // MARK: - BookReader

    func apply(settings: ReaderSettings, dark: Bool) {
        self.settings = settings
        self.dark = dark
        let background = UIColor(hex: settings.tokens(dark: dark).background)
        view.backgroundColor = background
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        guard isLoaded else { return }
        let css = themeCSS()
        Task {
            let here = await currentSpot()
            _ = try? await webView.callAsyncJavaScript("stacks.setTheme(css)", arguments: ["css": css], contentWorld: .page)
            if let here {
                try? await Task.sleep(for: .milliseconds(100))
                await goTo(index: here.index, progression: here.progression)
            }
        }
    }

    func show(annotations: [Annotation]) {
        pendingAnnotations = annotations
        guard isLoaded else { return }
        let items: [[String: Any]] = annotations.compactMap { a in
            guard a.isPlaced, let locator = try? ReadiumShared.Locator(jsonString: a.locator.jsonString()),
                  let index = chapterIndex(locator.href), let text = locator.text.highlight else { return nil }
            return ["id": a.annotationId, "index": index, "highlight": text,
                    "before": locator.text.before ?? "", "after": locator.text.after ?? "",
                    "color": Palette.highlight[a.color] ?? Palette.midnight.accent,
                    "kind": a.kind == .note ? "note" : "highlight"]
        }
        Task {
            let drawn = try? await webView.callAsyncJavaScript("return stacks.showAnnotations(items)", arguments: ["items": items], contentWorld: .page)
            log.debug("highlights: \(items.count) placed, \(String(describing: drawn)) drawn")
        }
    }

    func go(to locator: ReadiumShared.Locator) async {
        guard let index = chapterIndex(locator.href) else { return }
        if let highlight = locator.text.highlight,
           let found = try? await webView.callAsyncJavaScript(
               "return stacks.goToText(index, before, highlight, after)",
               arguments: ["index": index, "before": locator.text.before ?? "", "highlight": highlight, "after": locator.text.after ?? ""],
               contentWorld: .page) as? Bool, found {
            return
        }
        let fragment = locator.locations.fragments.first ?? locator.href.fragment
        await goTo(index: index, progression: locator.locations.progression ?? 0,
                   fragment: locator.locations.progression == nil ? fragment : nil)
    }

    func go(to link: ReadiumShared.Link) async {
        let url = link.url()
        guard let index = chapterIndex(url) else { return }
        await goTo(index: index, progression: 0, fragment: url.fragment)
    }

    // MARK: - going and reporting

    private func goTo(index: Int, progression: Double, fragment: String? = nil) async {
        _ = try? await webView.callAsyncJavaScript("stacks.go(index, progression, fragment)",
                                                   arguments: ["index": index, "progression": progression, "fragment": fragment ?? NSNull()],
                                                   contentWorld: .page)
    }

    private func currentSpot() async -> (index: Int, progression: Double)? {
        guard let spot = try? await webView.callAsyncJavaScript("return stacks.current()", contentWorld: .page) as? [String: Any],
              let index = (spot["index"] as? NSNumber)?.intValue, let progression = (spot["progression"] as? NSNumber)?.doubleValue else { return nil }
        return (index, progression)
    }

    private func chapterIndex(_ href: AnyURL) -> Int? {
        let bare = href.removingFragment()
        return chapters.firstIndex { $0.url().removingFragment().isEquivalentTo(bare) }
    }

    /// A Readium locator for a spot in chapter `index`, with the position number and whole-book progress page mode would give.
    private func locator(index: Int, progression: Double, text: ReadiumShared.Locator.Text = .init()) -> ReadiumShared.Locator {
        let link = chapters[index]
        var total: Double?
        var position: Int?
        if index < chapterSpans.count {
            let span = chapterSpans[index]
            total = span.start + progression * (span.end - span.start)
            position = span.first + min(span.count - 1, Int(progression * Double(span.count)))
        }
        return ReadiumShared.Locator(href: link.url(), mediaType: link.mediaType ?? .xhtml, title: link.title,
                                     locations: .init(progression: progression, totalProgression: total, position: position),
                                     text: text)
    }

    fileprivate func received(_ message: WKScriptMessage) {
        switch message.name {
        case "location":
            guard let body = message.body as? [String: Any], let index = (body["index"] as? NSNumber)?.intValue,
                  let progression = (body["progression"] as? NSNumber)?.doubleValue, index < chapters.count else { return }
            onLocation?(locator(index: index, progression: progression))
        case "tap":
            onTap?()
        case "annotationTapped":
            if let id = message.body as? String { onAnnotationTapped?(id) }
        case "external":
            if let s = message.body as? String, let url = URL(string: s) { UIApplication.shared.open(url) }
        default:
            break
        }
    }

    // MARK: - highlight and note (the selection's edit menu)

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .context else { return }
        let actions = [
            UIAction(title: "Highlight") { [weak self] _ in Task { await self?.annotateSelection(.highlight) } },
            UIAction(title: "Note") { [weak self] _ in Task { await self?.annotateSelection(.note) } },
        ]
        builder.insertChild(UIMenu(title: "", options: .displayInline, children: actions), atStartOfMenu: .standardEdit)
    }

    private func annotateSelection(_ kind: AnnotationKind) async {
        guard let sel = try? await webView.callAsyncJavaScript("return stacks.selection()", contentWorld: .page) as? [String: Any],
              let index = (sel["index"] as? NSNumber)?.intValue, index < chapters.count,
              let highlight = sel["highlight"] as? String, !highlight.isEmpty else { return }
        let text = ReadiumShared.Locator.Text(after: sel["after"] as? String, before: sel["before"] as? String, highlight: highlight)
        let spot = locator(index: index, progression: (sel["progression"] as? NSNumber)?.doubleValue ?? 0, text: text)
        let clear = { [weak self] in Task { _ = try? await self?.webView.callAsyncJavaScript("stacks.clearSelection()", contentWorld: .page) } }
        guard kind == .note else {
            onAnnotate?(spot, highlight, .highlight, nil)
            clear()
            return
        }
        let alert = UIAlertController(title: "Note", message: highlight, preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "Your note" }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Save", style: .default) { [weak self] _ in
            let note = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            self?.onAnnotate?(spot, highlight, .note, note.isEmpty ? nil : note)
            clear()
        })
        present(alert, animated: true)
    }

    // MARK: - the page

    private func shellHTML() -> String {
        func face(_ family: String, _ file: String, style: String = "normal", weight: String = "normal") -> String {
            "@font-face { font-family: \"\(family)\"; src: url(\"\(BookFileServer.url("app/fonts/" + file).absoluteString)\"); font-style: \(style); font-weight: \(weight); }"
        }
        let fonts = [
            face("Literata", "Literata.ttf", weight: "200 900"),
            face("Literata", "Literata-Italic.ttf", style: "italic", weight: "200 900"),
            face("Atkinson Hyperlegible", "AtkinsonHyperlegible-Regular.ttf"),
            face("Atkinson Hyperlegible", "AtkinsonHyperlegible-Bold.ttf", weight: "bold"),
            face("Atkinson Hyperlegible", "AtkinsonHyperlegible-Italic.ttf", style: "italic"),
            face("Atkinson Hyperlegible", "AtkinsonHyperlegible-BoldItalic.ttf", style: "italic", weight: "bold"),
            face("AccessibleDfA", "AccessibleDfA.otf"),
        ].joined(separator: "\n")
        return """
        <!doctype html>
        <html><head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>\(fonts)</style>
        <style id="stacks-theme">\(themeCSS())</style>
        <style id="stacks-highlights"></style>
        <script src="\(BookFileServer.url("app/reader.js").absoluteString)"></script>
        </head><body><main id="book"></main></body></html>
        """
    }

    private func themeCSS() -> String {
        let t = settings.tokens(dark: dark)
        let family: String? = switch settings.font {
        case .publisher: nil
        case .literata: "\"Literata\", serif"
        case .atkinson: "\"Atkinson Hyperlegible\", sans-serif"
        case .serif: "\"Iowan Old Style\", \"Palatino\", Georgia, serif"
        case .sans: "-apple-system, \"Helvetica Neue\", sans-serif"
        case .accessible: "\"AccessibleDfA\", sans-serif"
        }
        var css = """
        html { -webkit-text-size-adjust: 100%; background: \(t.background) !important; }
        body { margin: 0; padding: 0; background: \(t.background) !important; color: \(t.text) !important; }
        #book { zoom: \(settings.fontSize); max-width: 38em; margin: 0 auto; box-sizing: border-box; /* zoom: text size, re-wrapped to the screen */
                padding: max(48px, env(safe-area-inset-top)) \(Int(20 * settings.margins))px 40vh;
                font-family: "Iowan Old Style", "Sitka Text", Palatino, serif; } /* Readium's default when the book names none */
        #book, #book * { color: \(t.text) !important; background-color: transparent !important; }
        #book img, #book svg { max-width: 100%; height: auto; }
        #book > section + section { margin-top: 3em; }
        ::selection { background: \(t.accent)55; }
        """
        if let family {
            css += "\n#book, #book *:not(code):not(pre):not(kbd):not(samp) { font-family: \(family) !important; }"
        }
        if let lineHeight = settings.lineHeight {
            css += "\n#book p, #book li, #book blockquote, #book div { line-height: \(lineHeight) !important; }"
        }
        return css
    }
}

/// Keeps the web view's message handlers from holding the controller (WKUserContentController retains them).
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: ScrollReaderController?
    init(_ target: ScrollReaderController) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated { target?.received(message) }
    }
}

/// Serves the book's files, the page and its script, and the bundled fonts to the web view under
/// `stacks-book://reader/`, so the page and the chapters it fetches share one origin.
final class BookFileServer: NSObject, WKURLSchemeHandler {
    static let scheme = "stacks-book"
    static func url(_ path: String) -> URL { URL(string: "\(scheme)://reader/\(path)")! }

    private let publication: Publication
    @MainActor var shell = ""
    private var stopped: Set<ObjectIdentifier> = []

    init(publication: Publication) {
        self.publication = publication
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        let prefix = "\(Self.scheme)://reader/"
        guard let full = task.request.url?.absoluteString, full.hasPrefix(prefix) else { return fail(task) }
        var path = String(full.dropFirst(prefix.count))
        if let cut = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<cut]) }
        switch path {
        case "app/shell.html":
            respond(task, Data(shell.utf8), "text/html")
        case "app/reader.js":
            guard let url = Bundle.main.url(forResource: "ScrollReader", withExtension: "js"), let data = try? Data(contentsOf: url) else { return fail(task) }
            respond(task, data, "text/javascript")
        case let p where p.hasPrefix("app/fonts/"):
            let name = String(p.dropFirst("app/fonts/".count))
            guard let url = Self.fontURL(name), let data = try? Data(contentsOf: url) else { return fail(task) }
            respond(task, data, name.hasSuffix(".otf") ? "font/otf" : "font/ttf")
        case let p where p.hasPrefix("book/"):
            let href = String(p.dropFirst("book/".count))
            guard let url = AnyURL(string: href), let found = publication.get(url) else { return fail(task) }
            let mime = publication.linkWithHREF(url)?.mediaType?.string ?? "application/octet-stream"
            let id = ObjectIdentifier(task)
            nonisolated(unsafe) let resource = found
            Task { @MainActor in
                let result = await resource.read()
                guard !self.stopped.contains(id) else { return }
                switch result {
                case .success(let data): self.respond(task, data, mime)
                case .failure: self.fail(task)
                }
            }
        default:
            fail(task)
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private static func fontURL(_ name: String) -> URL? {
        let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
        if let url = Bundle.main.url(forResource: base, withExtension: ext) { return url }
        // Readium's copy, used by its own reader for the "Accessible DfA" choice.
        return Bundle.main.url(forResource: "Readium_ReadiumNavigator", withExtension: "bundle")
            .flatMap(Bundle.init(url:))?
            .url(forResource: base, withExtension: ext, subdirectory: "Assets/Static/readium-css/fonts")
    }

    private func respond(_ task: any WKURLSchemeTask, _ data: Data, _ mime: String) {
        guard let url = task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": mime, "Content-Length": "\(data.count)"]) else { return }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func fail(_ task: any WKURLSchemeTask) {
        task.didFailWithError(URLError(.fileDoesNotExist))
    }
}
