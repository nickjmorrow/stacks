// Highlights and margin notes on the book page. Ones whose chapter couldn't be found (some imported
// from Apple Books) are marked "not placed".

import SwiftUI
import StacksKit

struct AnnotationsList: View {
    @Environment(AppModel.self) private var model
    let book: LibraryBook
    /// Opens the reader at a placed highlight.
    var open: (Annotation) -> Void = { _ in }

    var body: some View {
        let items = model.annotations(book)
        VStack(alignment: .leading, spacing: 10) {
            Text("Highlights & notes").font(.headline).foregroundStyle(Ink.text)
            if items.isEmpty {
                Text(book.format == .pdf ? "Highlights work in EPUBs only for now." : "None yet. Select text while reading to add one.")
                    .font(.subheadline)
                    .foregroundStyle(Ink.faint)
            }
            ForEach(items) { a in
                Button { open(a) } label: { row(a) }
                    .buttonStyle(.plain)
                    .disabled(!a.isPlaced)
            }
        }
    }

    private func row(_ a: Annotation) -> some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: Palette.highlight[a.color] ?? Palette.midnight.accent))
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 4) {
                Text(a.text).font(.system(.callout, design: .serif)).foregroundStyle(Ink.text)
                if let note = a.note { Text(note).font(.callout).foregroundStyle(Ink.dim) }
                if !a.isPlaced { Text("Not placed in the book (its place didn't come over from Apple Books)").font(.caption).foregroundStyle(Ink.faint) }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}
