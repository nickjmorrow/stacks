// Hosts a Readium navigator (EPUB or PDF) and turns its events into Stacks' records: positions,
// highlights and notes. The SwiftUI screen around it handles the chrome.

import UIKit
import StacksKit
import ReadiumShared
import ReadiumNavigator

@MainActor
final class ReaderController: UIViewController, BookReader, EPUBNavigatorDelegate, PDFNavigatorDelegate {
    let publication: Publication
    let navigator: UIViewController & VisualNavigator
    var onLocation: ((ReadiumShared.Locator) -> Void)?
    var onTap: (() -> Void)?
    var onAnnotate: ((ReadiumShared.Locator, String, AnnotationKind, String?) -> Void)?
    var onAnnotationTapped: ((String) -> Void)?
    private let pageTurns = DirectionalNavigationAdapter(animatedTransition: true)
    private var tapTokens: [InputObservableToken] = []

    init(publication: Publication, initialLocation: ReadiumShared.Locator?, settings: ReaderSettings, dark: Bool) throws {
        self.publication = publication
        if publication.conforms(to: .epub) {
            var config = EPUBNavigatorViewController.Configuration()
            config.preferences = settings.epub(dark: dark)
            config.fontFamilyDeclarations = BundledFonts.declarations
            config.editingActions = EditingAction.defaultActions + [
                EditingAction(title: "Highlight", action: #selector(ReaderController.highlightSelection(_:))),
                EditingAction(title: "Note", action: #selector(ReaderController.noteSelection(_:))),
            ]
            navigator = try EPUBNavigatorViewController(publication: publication, initialLocation: initialLocation, config: config)
        } else {
            var config = PDFNavigatorViewController.Configuration()
            config.preferences = settings.pdf(dark: dark)
            navigator = try PDFNavigatorViewController(publication: publication, initialLocation: initialLocation, config: config)
        }
        super.init(nibName: nil, bundle: nil)
        (navigator as? EPUBNavigatorViewController)?.delegate = self
        (navigator as? PDFNavigatorViewController)?.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    var isEPUB: Bool { navigator is EPUBNavigatorViewController }

    override func viewDidLoad() {
        super.viewDidLoad()
        addChild(navigator)
        navigator.view.frame = view.bounds
        navigator.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(navigator.view)
        navigator.didMove(toParent: self)
        // Taps near the edges and the arrow keys turn pages; other taps show or hide the controls.
        pageTurns.bind(to: navigator)
        tapTokens = [
            navigator.addObserver(.tap { [weak self] _ in self?.onTap?(); return true }),
            navigator.addObserver(.click { [weak self] _ in self?.onTap?(); return true }), // Mac and the Simulator
        ]
        (navigator as? DecorableNavigator)?.observeDecorationInteractions(inGroup: "highlights") { [weak self] event in
            self?.onAnnotationTapped?(event.decoration.id)
        }
    }

    func apply(settings: ReaderSettings, dark: Bool) {
        (navigator as? EPUBNavigatorViewController)?.submitPreferences(settings.epub(dark: dark))
        (navigator as? PDFNavigatorViewController)?.submitPreferences(settings.pdf(dark: dark))
    }

    /// Draws the placed highlights and notes.
    func show(annotations: [Annotation]) {
        guard let decorable = navigator as? DecorableNavigator else { return }
        let decorations: [Decoration] = annotations.compactMap { a in
            guard a.isPlaced, let locator = try? ReadiumShared.Locator(jsonString: a.locator.jsonString()) else { return nil }
            let tint = UIColor(hex: Palette.highlight[a.color] ?? Palette.midnight.accent)
            return Decoration(id: a.annotationId, locator: locator,
                              style: a.kind == .note ? .underline(tint: tint) : .highlight(tint: tint))
        }
        decorable.apply(decorations: decorations, in: "highlights")
    }

    func go(to locator: ReadiumShared.Locator) async {
        _ = await navigator.go(to: locator, options: NavigatorGoOptions())
    }

    func go(to link: ReadiumShared.Link) async {
        _ = await navigator.go(to: link, options: NavigatorGoOptions())
    }

    // MARK: - selection actions (reached through the responder chain)

    @objc func highlightSelection(_ sender: Any?) {
        guard let nav = navigator as? SelectableNavigator, let sel = nav.currentSelection else { return }
        onAnnotate?(sel.locator, sel.locator.text.highlight ?? "", .highlight, nil)
        nav.clearSelection()
    }

    @objc func noteSelection(_ sender: Any?) {
        guard let nav = navigator as? SelectableNavigator, let sel = nav.currentSelection else { return }
        let alert = UIAlertController(title: "Note", message: sel.locator.text.highlight, preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "Your note" }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Save", style: .default) { [weak self] _ in
            let note = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            self?.onAnnotate?(sel.locator, sel.locator.text.highlight ?? "", .note, note.isEmpty ? nil : note)
            nav.clearSelection()
        })
        present(alert, animated: true)
    }

    // MARK: - navigator delegate

    func navigator(_ navigator: Navigator, locationDidChange locator: ReadiumShared.Locator) {
        onLocation?(locator)
    }

    func navigator(_ navigator: Navigator, presentError error: NavigatorError) {
        let alert = UIAlertController(title: "Couldn't show this", message: String(describing: error), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
