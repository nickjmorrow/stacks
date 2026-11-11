// The library: Reading Now, filters, and the table. The open book is pushed over it.

import SwiftUI
import StacksKit

struct LibraryView: View {
    @Environment(AppModel.self) private var model
    @State private var settings = false
    var body: some View {
        // The table gets the whole window; the open book is pushed over it (not a sheet: the reader is a
        // full-screen cover and crashed when presented from inside a sheet).
        NavigationStack {
            chrome
                .navigationDestination(item: Binding(
                    get: { model.book(model.selected) },
                    set: { if $0 == nil { model.selected = nil } })) { book in
                    // A new identity per book: a widget tap while another book is open closes that reader first.
                    BookView(book: book).id(book.bookId)
                }
        }
        .background(Ink.bg)
    }

    private var chrome: some View {
        content
            .navigationTitle("Stacks")
            .modifier(DebouncedSearch())
            .toolbar {
                ToolbarItem(placement: .secondaryAction) {
                    Button("Settings", systemImage: "gearshape") { settings = true }
                }
            }
            .refreshable { await model.sync() }
            .background(Ink.bg)
            .toolbarBackground(Ink.bg, for: .navigationBar)
            .sheet(isPresented: $settings) { SettingsView().environment(model) }
    }

    @ViewBuilder private var content: some View {
        @Bindable var model = model
        if model.library == nil {
            ContentUnavailableView {
                Label(model.offline ? "Can't reach the server" : "Loading your books", systemImage: "books.vertical")
            } description: {
                Text(model.offline ? "Stacks needs Tailscale on to reach \(model.serverURL) the first time." : "")
            }
        } else if model.books.isEmpty {
            ContentUnavailableView("No books yet", systemImage: "books.vertical",
                                   description: Text("Your books appear here once they've been added on the server."))
        } else {
            VStack(spacing: 0) {
                header
                BookTable()
            }
        }
    }

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            SyncLine()
            if !model.filter.isActive && !model.readingNow.isEmpty {
                Text("Reading now").font(.headline).foregroundStyle(Ink.text).padding(.horizontal)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(model.readingNow) { book in
                            Button { model.selected = book.bookId } label: {
                                CoverView(book: book, url: model.coverURL(book), width: 84)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(book.name)
                        }
                    }
                    .padding(.horizontal)
                }
            }
            FilterBar()
            Text("\(model.shown.count) books").font(.caption).foregroundStyle(Ink.faint).padding(.horizontal)
        }
        .padding(.vertical, 8)
    }
}

/// "Offline · synced 2 h ago", downloads in progress, or a sync problem.
struct SyncLine: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let parts: [String] = [
            model.offline ? "Offline" : nil,
            model.offline || model.syncError != nil ? model.lastSynced.map { "synced \($0.formatted(.relative(presentation: .named)))" } : nil,
            model.syncError.map { "Sync problem: \($0)" },
            model.notice,
            model.downloadProgress.map { "Downloading \($0.done) of \($0.total)" },
        ].compactMap { $0 }
        if !parts.isEmpty {
            Text(parts.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(model.syncError == nil ? Ink.dim : Ink.danger)
                .padding(.horizontal)
        }
    }
}

/// The search field. What's typed lives here, not in LibraryView, so a keystroke redraws only the field; the
/// filter (and the table) update once typing pauses. The field follows the filter only when it is cleared elsewhere.
private struct DebouncedSearch: ViewModifier {
    @Environment(AppModel.self) private var model
    @State private var typed = ""
    @State private var pending: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .searchable(text: $typed, prompt: "Title, author, tag, who recommended it")
            .onChange(of: typed) { _, text in
                pending?.cancel()
                pending = Task {
                    try? await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    model.filter.search = text
                    pending = nil
                }
            }
            .onChange(of: model.filter.search) { _, text in
                if text.isEmpty && pending == nil && !typed.isEmpty { typed = "" }
            }
    }
}
