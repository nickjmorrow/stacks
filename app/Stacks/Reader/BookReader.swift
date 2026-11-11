// What the reading screen needs from whatever shows the book: Readium's navigator (pages, PDFs,
// fixed-layout books) or Stacks' own continuous scroll for reflowable EPUBs.

import UIKit
import StacksKit
import ReadiumShared

@MainActor
protocol BookReader: UIViewController {
    var onLocation: ((ReadiumShared.Locator) -> Void)? { get set }
    var onTap: (() -> Void)? { get set }
    var onAnnotate: ((ReadiumShared.Locator, String, AnnotationKind, String?) -> Void)? { get set }
    var onAnnotationTapped: ((String) -> Void)? { get set }
    func apply(settings: ReaderSettings, dark: Bool)
    func show(annotations: [Annotation])
    func go(to locator: ReadiumShared.Locator) async
    func go(to link: ReadiumShared.Link) async
}

/// Scrolling a reflowable EPUB uses Stacks' own view, because Readium shows one chapter at a time and
/// can't flow them together; everything else is Readium's.
@MainActor
func makeBookReader(publication: Publication, initialLocation: ReadiumShared.Locator?, settings: ReaderSettings, dark: Bool) throws -> any BookReader {
    if usesContinuousScroll(publication, settings) {
        return ScrollReaderController(publication: publication, initialLocation: initialLocation, settings: settings, dark: dark)
    }
    return try ReaderController(publication: publication, initialLocation: initialLocation, settings: settings, dark: dark)
}

func usesContinuousScroll(_ publication: Publication, _ settings: ReaderSettings) -> Bool {
    settings.scroll && publication.conforms(to: .epub) && publication.metadata.layout != .fixed
}
