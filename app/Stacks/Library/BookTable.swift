// The library as a dense table: one line per book, so many fit on screen. Sorting is the Sort menu in the filter bar.

import SwiftUI
import StacksKit

struct BookTable: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        @Bindable var model = model
        Table(model.shown, selection: $model.selected) {
            TableColumn("Title") { book in
                if sizeClass == .compact {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(book.name).foregroundStyle(Ink.text).lineLimit(1)
                        Text(byline(book)).font(.caption).foregroundStyle(Ink.dim).lineLimit(1)
                    }
                } else {
                    Text(book.name).font(.system(.body, design: .serif)).foregroundStyle(Ink.text).lineLimit(1)
                }
            }
            TableColumn("Author") { book in Text(book.author ?? "").foregroundStyle(Ink.dim).lineLimit(1) }
                .width(min: 120, ideal: 180)
            TableColumn("Year") { book in Text(book.year.map(String.init) ?? "").foregroundStyle(Ink.dim) }
                .width(48)
            TableColumn("Status") { book in StatusChip(status: book.status) }
                .width(80)
            TableColumn("Rating") { book in
                if let r = book.rating { Stars(rating: r, size: 10) }
            }
            .width(72)
            TableColumn("Tags") { book in
                Text(book.tags.joined(separator: " · ")).font(.caption).foregroundStyle(Ink.faint).lineLimit(1)
            }
            .width(min: 100, ideal: 220)
        }
        .scrollContentBackground(.hidden)
    }
}
