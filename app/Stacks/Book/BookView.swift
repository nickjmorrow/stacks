// One book: the facts from Grimoire, what the reader thinks of it (every change saves at once), its highlights
// and notes, and the Read button.

import SwiftUI
import StacksKit

struct BookView: View {
    @Environment(AppModel.self) private var model
    let book: LibraryBook
    @State private var reading = false
    @State private var rec = ""
    @State private var editingTags = false
    /// Set when a highlight in the list is tapped: the reader opens there.
    @State private var startAt: StacksKit.JSONValue?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 16) {
                    CoverView(book: book, url: model.coverURL(book), width: 120)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(book.name)
                            .font(.system(.title2, design: .serif).weight(.semibold))
                            .foregroundStyle(Ink.text)
                        Text(byline(book)).foregroundStyle(Ink.dim)
                        if let genre = book.genre, !genre.isEmpty {
                            Text(genre.joined(separator: ", ")).font(.subheadline).foregroundStyle(Ink.faint)
                        }
                        if let progress = book.progress { Text(progress).font(.subheadline).foregroundStyle(Ink.faint) }
                    }
                }
                if let summary = book.summary {
                    Text(summary).font(.system(.body, design: .serif)).foregroundStyle(Ink.text)
                }

                readButton

                Picker("Status", selection: Binding(get: { book.status }, set: { model.setStatus(book, $0) })) {
                    ForEach(BookStatus.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                HStack(spacing: 6) {
                    ForEach(1...5, id: \.self) { i in
                        Button {
                            model.setRating(book, book.rating == i ? nil : i)
                        } label: {
                            Image(systemName: i <= (book.rating ?? 0) ? "star.fill" : "star")
                                .font(.title2)
                                .foregroundStyle(i <= (book.rating ?? 0) ? Ink.sun : Ink.faint)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(i) stars")
                    }
                    if let finished = book.finished {
                        Spacer()
                        Text("Finished \(finished)").font(.subheadline).foregroundStyle(Ink.dim)
                    }
                }

                tagsSection

                LabeledContent("Recommended by") {
                    TextField("Who told you about it", text: $rec)
                        .multilineTextAlignment(.trailing)
                        .onSubmit { model.setRec(book, rec) }
                }
                .foregroundStyle(Ink.dim)

                AnnotationsList(book: book) { a in
                    guard model.localFile(book) != nil else { return }
                    startAt = a.locator
                    reading = true
                }

                if book.pendingEdit {
                    Label("Waiting to reach Grimoire", systemImage: "clock").font(.caption).foregroundStyle(Ink.faint)
                }
            }
            .padding()
        }
        .background(Ink.bg)
        .navigationTitle(book.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            rec = book.rec ?? ""
            openRequested()
        }
        .onChange(of: book.bookId) {
            rec = book.rec ?? ""
            openRequested()
        }
        .onChange(of: model.readRequest) { openRequested() }
        // Presented content gets the model passed in: on Mac the reader's cover didn't inherit it and crashed.
        .fullScreenCover(isPresented: $reading) { ReaderScreen(book: book, startAt: startAt).environment(model) }
        .sheet(isPresented: $editingTags) { TagPicker(book: book).environment(model) }
    }

    /// A stacks://book link asked for this book: open the reader if the file is here, else just show the page.
    private func openRequested() {
        guard model.readRequest == book.bookId else { return }
        model.readRequest = nil
        guard model.localFile(book) != nil else { return }
        startAt = nil
        // Let a reader that is closing (another book was open) finish leaving before this one presents.
        Task {
            try? await Task.sleep(for: .milliseconds(300))
            reading = true
        }
    }

    @ViewBuilder private var readButton: some View {
        let local = model.localFile(book)
        if local == nil && model.couldNotDownload(book) {
            HStack {
                Label("Couldn't download", systemImage: "exclamationmark.triangle").foregroundStyle(Ink.dim)
                Spacer()
                Button("Try again") { model.retryDownload(book) }
            }
        } else {
            readButtonCore(local)
        }
    }

    @ViewBuilder private func readButtonCore(_ local: URL?) -> some View {
        Button {
            startAt = nil
            reading = true
        } label: {
            Label(local == nil ? "Downloading…" : "Read", systemImage: "book")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
        }
        .buttonStyle(.borderedProminent)
        .tint(Ink.sun)
        .foregroundStyle(Ink.bg)
        .disabled(local == nil)
    }

    @ViewBuilder private var tagsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Tags").font(.headline).foregroundStyle(Ink.text)
                Spacer()
                Button("Edit") { editingTags = true }.font(.subheadline)
            }
            if book.tags.isEmpty {
                Text("None").foregroundStyle(Ink.faint)
            } else {
                ForEach(book.tags, id: \.self) { tag in
                    HStack {
                        Text(model.groupOf(tag: tag)).font(.caption).foregroundStyle(Ink.faint).frame(width: 64, alignment: .leading)
                        Text(tag).foregroundStyle(Ink.text)
                    }
                }
            }
        }
    }
}

/// Pick tags from those in use, or add a new one.
struct TagPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let book: LibraryBook
    @State private var picked: Set<String> = []
    @State private var newTag = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("New tag", text: $newTag)
                        Button("Add") {
                            let t = newTag.trimmingCharacters(in: .whitespaces)
                            if !t.isEmpty, !t.contains("[["), !t.contains("]]") { picked.insert(t) }
                            newTag = ""
                        }
                    }
                }
                ForEach(model.groups, id: \.name) { group in
                    Section(group.name) {
                        ForEach(group.tags, id: \.self) { tag in
                            Button {
                                if picked.contains(tag) { picked.remove(tag) } else { picked.insert(tag) }
                            } label: {
                                HStack {
                                    Text(tag).foregroundStyle(Ink.text)
                                    Spacer()
                                    if picked.contains(tag) { Image(systemName: "checkmark").foregroundStyle(Ink.sun) }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Tags")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        model.setTags(book, picked.sorted())
                        dismiss()
                    }
                }
            }
            .onAppear { picked = Set(book.tags) }
        }
    }
}
