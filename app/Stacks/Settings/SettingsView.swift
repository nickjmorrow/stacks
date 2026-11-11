import SwiftUI
import StacksKit

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var server = ""

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section("Reading") {
                    Stepper("Daily goal: \(model.goalMinutes) min", value: $model.goalMinutes, in: 1...120)
                    Text("A day counts when you read at least this long.").font(.caption).foregroundStyle(Ink.faint)
                }
                Section("Server") {
                    TextField("https://…", text: $server)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Button("Use this server") { model.serverURL = server.trimmingCharacters(in: .whitespaces) }
                        .disabled(URL(string: server) == nil || server == model.serverURL)
                    Text("Stacks talks to its server over Tailscale. Keep Tailscale on to sync.").font(.caption).foregroundStyle(Ink.faint)
                }
                Section("This device") {
                    LabeledContent("Name", value: model.device)
                    LabeledContent("Books on this device", value: "\(model.books.filter { model.localFile($0) != nil }.count) of \(model.books.count)")
                    Button("Sync now") { Task { await model.sync() } }
                    if let at = model.lastSynced { LabeledContent("Last synced", value: at.formatted(date: .abbreviated, time: .shortened)) }
                    if let e = model.syncError { Text(e).font(.caption).foregroundStyle(Ink.danger) }
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { server = model.serverURL }
        }
    }
}
