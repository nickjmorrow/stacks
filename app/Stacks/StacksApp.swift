import SwiftUI
import StacksKit

@main
struct StacksApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Ink.sun)
                .background(Ink.bg.ignoresSafeArea())
                .task { await model.sync() }
                .onOpenURL { url in
                    if url.isFileURL { Task { await model.importFile(url) } }
                    else if let link = DeepLink(url: url) { model.open(link) }
                }
                .onChange(of: phase) { _, now in
                    if now == .active { Task { await model.sync() } }
                }
        }
    }
}
