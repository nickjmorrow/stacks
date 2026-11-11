import SwiftUI
import StacksKit

func byline(_ b: LibraryBook) -> String {
    [b.author, b.year.map(String.init)].compactMap { $0 }.joined(separator: " · ")
}

struct StatusChip: View {
    let status: BookStatus

    var body: some View {
        Text(status.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(status == .doing ? Ink.bg : Ink.dim)
            .background(status == .doing ? Ink.sun : Ink.raised, in: Capsule())
    }
}

struct Stars: View {
    let rating: Int
    var size: CGFloat = 14

    var body: some View {
        HStack(spacing: 1) {
            ForEach(1...5, id: \.self) { i in
                Image(systemName: i <= rating ? "star.fill" : "star")
                    .font(.system(size: size))
                    .foregroundStyle(i <= rating ? Ink.sun : Ink.faint)
            }
        }
        .accessibilityLabel("\(rating) of 5 stars")
    }
}
