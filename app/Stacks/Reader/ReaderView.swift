// The reading screen: opens the book where the reader was last (on any device), offers a jump to the furthest
// point, saves the position on every page turn, times the session, and adds highlights and notes.

import SwiftUI
import UIKit
import StacksKit
import ReadiumShared
import ReadiumStreamer
import ReadiumNavigator

struct ReaderScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scenePhase) private var phase
    let book: LibraryBook
    /// Open here instead of the last position (a highlight tapped in the book's list).
    var startAt: StacksKit.JSONValue? = nil

    @State private var controller: (any BookReader)?
    @State private var publication: Publication?
    /// Where the reader is now, so switching between scrolling and pages keeps the spot.
    @State private var here: ReadiumShared.Locator?
    @State private var failure: String?
    @State private var chrome = true
    @State private var settings = ReaderSettings()
    @State private var showSettings = false
    @State private var showContents = false
    @State private var contents: [ReadiumShared.Link] = []
    @State private var progression = 0.0
    @State private var offer: Position?
    @State private var tracker: SessionTracker?
    @State private var askedMarkRead = false
    @State private var markRead = false
    @State private var tappedAnnotation: Annotation?
    /// The book's last position number, for "Mark as read?".
    @State private var lastPosition: Int?
    /// The navigator reports where it opened; that isn't a move, and saving it would stamp a stale spot as the newest.
    @State private var skipNextLocation = false
    /// When this device last really moved in the book (ms), or the position it opened from.
    @State private var movedAt: Int64 = 0

    private var tokens: ThemeTokens { settings.tokens(dark: scheme == .dark) }

    var body: some View {
        ZStack {
            Color(hex: tokens.background).ignoresSafeArea()
            if let controller {
                ReaderHost(controller: controller).ignoresSafeArea().id(ObjectIdentifier(controller))
            } else if let failure {
                ContentUnavailableView("Couldn't open this book", systemImage: "exclamationmark.triangle", description: Text(failure))
            } else {
                ProgressView()
            }
            if chrome { chromeOverlay }
            if let offer { offerBanner(offer) }
        }
        .statusBarHidden(!chrome)
        .task { await open() }
        .task { await syncWhileReading() }
        .onDisappear { finish() }
        .onChange(of: phase) { _, now in
            switch now {
            case .background: pause()
            case .active:
                if tracker == nil, controller != nil { tracker = SessionTracker(bookId: book.bookId, device: model.device, start: progression, at: Date()) }
                Task { await catchUpWithOtherDevices() }
            default: break
            }
        }
        .onChange(of: settings) { old, s in
            s.save(model.store)
            if let publication, usesContinuousScroll(publication, old) != usesContinuousScroll(publication, s) {
                showBook(at: here)
            } else {
                controller?.apply(settings: s, dark: scheme == .dark)
            }
        }
        .sheet(isPresented: $showSettings) { ReaderSettingsView(settings: $settings, isPDF: book.format == .pdf) }
        .sheet(isPresented: $showContents) { contentsList }
        .alert("Mark as read?", isPresented: $markRead) {
            Button("Mark as read") { model.setStatus(book, .done) }
            Button("Not yet", role: .cancel) {}
        } message: {
            Text("You've reached the end of \(book.name).")
        }
        .confirmationDialog("Highlight", isPresented: Binding(get: { tappedAnnotation != nil }, set: { if !$0 { tappedAnnotation = nil } }),
                            presenting: tappedAnnotation) { a in
            ForEach(HighlightColor.allCases, id: \.self) { c in
                Button(c.rawValue.capitalized) { update(a) { $0.color = c } }
            }
            Button("Delete", role: .destructive) { update(a) { $0.deletedAt = $0.updatedAt } }
        } message: { a in
            Text(a.note ?? a.text)
        }
    }

    // MARK: - chrome

    private var chromeOverlay: some View {
        VStack {
            HStack(spacing: 16) {
                Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel("Close")
                Text(book.name).font(.headline).lineLimit(1).frame(maxWidth: .infinity)
                Button { showContents = true } label: { Image(systemName: "list.bullet") }.accessibilityLabel("Contents")
                Button { showSettings = true } label: { Image(systemName: "textformat.size") }.accessibilityLabel("Reading settings")
            }
            .padding()
            .background(.ultraThinMaterial)
            Spacer()
            HStack {
                ProgressView(value: progression).tint(Color(hex: tokens.accent))
                Text("\(Int((progression * 100).rounded()))%").font(.caption.monospacedDigit())
            }
            .padding()
            .background(.ultraThinMaterial)
        }
        .foregroundStyle(Color(hex: tokens.text))
    }

    private func offerBanner(_ p: Position) -> some View {
        VStack {
            Spacer()
            HStack {
                Text("Pick up where you were on \(p.device.split(separator: "-").first.map(String.init) ?? "another device"): \(Int((p.progression * 100).rounded()))%?")
                    .font(.subheadline)
                Spacer()
                Button("Jump") {
                    if let l = try? ReadiumShared.Locator(jsonString: p.locator.jsonString()) { Task { await controller?.go(to: l) } }
                    offer = nil
                }
                Button { offer = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Dismiss")
            }
            .padding()
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(Ink.text)
            .padding()
            .padding(.bottom, 50)
        }
    }

    private var contentsList: some View {
        NavigationStack {
            List(Array(contents.enumerated()), id: \.offset) { _, link in
                Button(link.title ?? link.href) {
                    showContents = false
                    Task { await controller?.go(to: link) }
                }
            }
            .navigationTitle("Contents")
        }
    }

    // MARK: - opening and recording

    private func open() async {
        settings = ReaderSettings.load(model.store)
        guard let url = model.localFile(book), let fileURL = FileURL(url: url) else {
            failure = "The file isn't on this device yet."
            return
        }
        let http = DefaultHTTPClient()
        let retriever = AssetRetriever(httpClient: http)
        let opener = PublicationOpener(parser: DefaultPublicationParser(httpClient: http, assetRetriever: retriever, pdfFactory: DefaultPDFDocumentFactory()))
        let asset: Asset
        switch await retriever.retrieve(url: fileURL) {
        case .success(let a): asset = a
        case .failure(let e): failure = "\(e)"; return
        }
        let publication: Publication
        switch await opener.open(asset: asset, allowUserInteraction: false) {
        case .success(let p): publication = p
        case .failure(let e): failure = "\(e)"; return
        }
        if case .success(let toc) = await publication.tableOfContents() { contents = toc }
        if case .success(let all) = await publication.positions() { lastPosition = all.count }
        var (start, furthest) = PositionPolicy.open(all: model.positions(book))
        var initial = start.flatMap { try? ReadiumShared.Locator(jsonString: $0.locator.jsonString()) }
        if let startAt, let l = try? ReadiumShared.Locator(jsonString: startAt.jsonString()) {
            initial = l
            furthest = nil
            start = nil
        }
        self.publication = publication
        here = initial
        movedAt = start?.updatedAt ?? 0
        showBook(at: initial)
        if controller != nil {
            progression = start?.progression ?? initial?.locations.totalProgression ?? 0
            offer = furthest
            tracker = SessionTracker(bookId: book.bookId, device: model.device, start: progression, at: Date())
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { withAnimation { chrome = false } }
        } else {
            return
        }
        // Opened from what this device knew; another device may have read on since its last sync.
        if startAt == nil { await catchUpWithOtherDevices() }
    }

    /// Shows the book at `locator` in the reader the settings call for (Stacks' scroll view or Readium's).
    private func showBook(at locator: ReadiumShared.Locator?) {
        guard let publication else { return }
        release(controller)
        do {
            let c = try makeBookReader(publication: publication, initialLocation: locator, settings: settings, dark: scheme == .dark)
            c.onLocation = { locator in record(locator) }
            c.onTap = { withAnimation(.easeOut(duration: 0.2)) { chrome.toggle() } }
            c.onAnnotate = { locator, text, kind, note in annotate(locator, text: text, kind: kind, note: note) }
            c.onAnnotationTapped = { id in tappedAnnotation = try? model.store.annotation(id: id) }
            skipNextLocation = true
            controller = c
            c.show(annotations: model.annotations(book))
        } catch {
            failure = "\(error)"
        }
    }

    /// The controller's closures hold this view's state; let both go.
    private func release(_ c: (any BookReader)?) {
        c?.onLocation = nil
        c?.onTap = nil
        c?.onAnnotate = nil
        c?.onAnnotationTapped = nil
    }

    /// Syncs, then offers to jump if another device has read on since this one last moved.
    private func catchUpWithOtherDevices() async {
        guard controller != nil else { return }
        await model.sync()
        guard let latest = PositionPolicy.open(all: model.positions(book)).start,
              latest.device != model.device, latest.updatedAt > movedAt,
              abs(latest.progression - progression) >= 0.001 else { return }
        offer = latest
    }

    private func record(_ locator: ReadiumShared.Locator) {
        let p = locator.locations.totalProgression ?? progression
        progression = p
        here = locator
        if skipNextLocation {
            skipNextLocation = false
            return
        }
        guard let json = try? locator.jsonString(), let parsed = StacksKit.JSONValue.parse(json) else { return }
        let value = LocatorFit.fit(parsed)
        let now = Date()
        movedAt = Int64(now.timeIntervalSince1970 * 1000)
        try? model.store.putPosition(Position(bookId: book.bookId, device: model.device, locator: value, progression: p,
                                              updatedAt: Int64(now.timeIntervalSince1970 * 1000)), dirty: true)
        if let s = tracker?.turn(to: p, at: now) { try? model.store.putSession(s, dirty: true) }
        let atEnd = (locator.locations.position.map { lastPosition != nil && $0 >= lastPosition! } ?? false) || p >= 0.995
        if atEnd && !askedMarkRead && book.status != .done {
            askedMarkRead = true
            markRead = true
        }
    }

    private func annotate(_ locator: ReadiumShared.Locator, text: String, kind: AnnotationKind, note: String?) {
        guard let json = try? locator.jsonString(), let parsed = StacksKit.JSONValue.parse(json) else { return }
        let value = LocatorFit.fit(parsed)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let a = Annotation(annotationId: UUID().uuidString.lowercased(), bookId: book.bookId, kind: kind, color: .yellow, locator: value,
                           text: text, note: note, createdAt: now, updatedAt: now, deletedAt: nil, device: model.device, source: .stacks)
        try? model.store.putAnnotation(a, dirty: true)
        refreshAnnotations()
    }

    private func update(_ a: Annotation, _ change: (inout Annotation) -> Void) {
        var next = a
        change(&next)
        next.updatedAt = max(Int64(Date().timeIntervalSince1970 * 1000), a.updatedAt + 1)
        if next.deletedAt != nil { next.deletedAt = next.updatedAt }
        try? model.store.putAnnotation(next, dirty: true)
        refreshAnnotations()
    }

    private func refreshAnnotations() {
        model.revision += 1
        controller?.show(annotations: model.annotations(book))
        Task { await model.sync() }
    }

    private func syncWhileReading() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(15))
            if Task.isCancelled { break }
            await model.sync()
        }
    }

    /// Leaving the app: end the session and send the position now, so another device opens here.
    private func pause() {
        if var t = tracker, let s = t.end(at: Date()) { try? model.store.putSession(s, dirty: true) }
        tracker = nil
        let task = UIApplication.shared.beginBackgroundTask(withName: "stacks-sync")
        Task {
            await model.sync(closing: book.bookId)
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    private func finish() {
        if var t = tracker, let s = t.end(at: Date()) { try? model.store.putSession(s, dirty: true) }
        tracker = nil
        release(controller)
        controller = nil
        let id = book.bookId
        Task { await model.sync(closing: id) }
    }
}

/// Puts the UIKit reader in SwiftUI.
struct ReaderHost: UIViewControllerRepresentable {
    let controller: UIViewController
    func makeUIViewController(context: Context) -> UIViewController { controller }
    func updateUIViewController(_ vc: UIViewController, context: Context) {}
}
