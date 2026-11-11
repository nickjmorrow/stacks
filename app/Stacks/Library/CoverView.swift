// A book's cover: the server's image, or one drawn from the title in Midnight Sun.

import SwiftUI
import StacksKit

struct CoverView: View {
    let book: LibraryBook
    let url: URL?
    var width: CGFloat = 60

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().aspectRatio(contentMode: .fill)
                    } else {
                        GeneratedCover(book: book, width: width)
                    }
                }
            } else {
                GeneratedCover(book: book, width: width)
            }
        }
        .frame(width: width, height: width * 1.5)
        .clipShape(RoundedRectangle(cornerRadius: width / 24))
        .overlay(RoundedRectangle(cornerRadius: width / 24).stroke(Ink.line, lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}

/// Title and author set in a serif on a navy panel, with a sun-yellow rule.
struct GeneratedCover: View {
    let book: LibraryBook
    let width: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: width * 0.06) {
            Rectangle().fill(Ink.sun).frame(width: width * 0.3, height: max(1, width * 0.02))
            Text(book.name)
                .font(.system(size: width * 0.13, weight: .semibold, design: .serif))
                .foregroundStyle(Ink.text)
                .lineLimit(5)
                .minimumScaleFactor(0.6)
            Spacer(minLength: 0)
            if let author = book.author {
                Text(author)
                    .font(.system(size: width * 0.085, design: .serif))
                    .foregroundStyle(Ink.dim)
                    .lineLimit(2)
            }
        }
        .padding(width * 0.1)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(LinearGradient(colors: [Ink.raised, Ink.surface], startPoint: .top, endPoint: .bottom))
    }
}
