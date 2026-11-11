// Reading settings, kept per device: theme, font, size, spacing, margins, pages or scrolling.

import SwiftUI
import StacksKit
import ReadiumNavigator
import ReadiumShared

struct ReaderSettings: Codable, Equatable {
    enum ThemeChoice: String, Codable, CaseIterable { case night, midnight, paper, system }
    enum FontChoice: String, Codable, CaseIterable { case publisher, literata, atkinson, serif, sans, accessible }

    var theme: ThemeChoice = .night
    var font: FontChoice = .publisher
    var fontSize: Double = 1.0
    var lineHeight: Double? = nil
    var margins: Double = 1.0
    var scroll = false
    /// One page or two side by side; optional so settings saved before it still load (nil: one page).
    var columns: ColumnCount? = nil

    static let key = "reader-settings"

    static func load(_ store: LocalStore) -> ReaderSettings {
        guard let s = try? store.setting(key), let d = s.data(using: .utf8), let v = try? JSONDecoder().decode(ReaderSettings.self, from: d) else {
            return ReaderSettings()
        }
        return v
    }

    func save(_ store: LocalStore) {
        if let d = try? JSONEncoder().encode(self) { try? store.setSetting(Self.key, String(decoding: d, as: UTF8.self)) }
    }

    /// The tokens for the chosen theme; "system" follows light or dark mode.
    func tokens(dark: Bool) -> ThemeTokens {
        switch theme {
        case .night: Palette.night
        case .midnight: Palette.midnight
        case .paper: Palette.paper
        case .system: dark ? Palette.night : Palette.paper
        }
    }

    func epub(dark: Bool) -> EPUBPreferences {
        let t = tokens(dark: dark)
        let family: FontFamily? = switch font {
        case .publisher: nil
        case .literata: .literata
        case .atkinson: .atkinsonHyperlegible
        case .serif: .serif
        case .sans: .sansSerif
        case .accessible: .accessibleDfA
        }
        return EPUBPreferences(
            backgroundColor: ReadiumNavigator.Color(hex: t.background),
            columnCount: columns ?? .one,
            fontFamily: family,
            fontSize: fontSize,
            lineHeight: lineHeight,
            pageMargins: margins,
            publisherStyles: font == .publisher && lineHeight == nil ? nil : false,
            scroll: scroll,
            textColor: ReadiumNavigator.Color(hex: t.text)
        )
    }

    func pdf(dark: Bool) -> PDFPreferences {
        PDFPreferences(backgroundColor: ReadiumNavigator.Color(hex: tokens(dark: dark).background), scroll: scroll)
    }
}

struct ReaderSettingsView: View {
    @Binding var settings: ReaderSettings
    let isPDF: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("Theme", selection: $settings.theme) {
                    Text("Night").tag(ReaderSettings.ThemeChoice.night)
                    Text("Midnight Sun").tag(ReaderSettings.ThemeChoice.midnight)
                    Text("Paper").tag(ReaderSettings.ThemeChoice.paper)
                    Text("Match system").tag(ReaderSettings.ThemeChoice.system)
                }
                Toggle("Scroll instead of pages", isOn: $settings.scroll)
                if !isPDF {
                    Picker("Pages", selection: Binding(get: { settings.columns ?? .one }, set: { settings.columns = $0 })) {
                        Text("One page").tag(ColumnCount.one)
                        Text("Two when wide").tag(ColumnCount.auto)
                        Text("Always two").tag(ColumnCount.two)
                    }
                    Picker("Font", selection: $settings.font) {
                        Text("The book's own").tag(ReaderSettings.FontChoice.publisher)
                        Text("Literata").tag(ReaderSettings.FontChoice.literata)
                        Text("Atkinson Hyperlegible").tag(ReaderSettings.FontChoice.atkinson)
                        Text("Serif").tag(ReaderSettings.FontChoice.serif)
                        Text("Sans serif").tag(ReaderSettings.FontChoice.sans)
                        Text("Accessible DfA").tag(ReaderSettings.FontChoice.accessible)
                    }
                    LabeledContent("Text size") {
                        Stepper("\(Int(settings.fontSize * 100))%", value: $settings.fontSize, in: 0.6...2.5, step: 0.1)
                    }
                    LabeledContent("Line spacing") {
                        Stepper(settings.lineHeight.map { String(format: "%.1f", $0) } ?? "Book's own",
                                onIncrement: { settings.lineHeight = min((settings.lineHeight ?? 1.4) + 0.1, 2.2) },
                                onDecrement: { settings.lineHeight = (settings.lineHeight ?? 1.4) <= 1.15 ? nil : (settings.lineHeight ?? 1.4) - 0.1 })
                    }
                    LabeledContent("Margins") {
                        Stepper(String(format: "%.1f", settings.margins), value: $settings.margins, in: 0.5...2.0, step: 0.25)
                    }
                }
            }
            .navigationTitle("Reading")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

extension FontFamily {
    nonisolated(unsafe) static let literata: FontFamily = "Literata"
    nonisolated(unsafe) static let atkinsonHyperlegible: FontFamily = "Atkinson Hyperlegible"
}

/// Literata and Atkinson Hyperlegible ship in the app (Stacks/Fonts, SIL Open Font License).
@MainActor
enum BundledFonts {
    static var declarations: [AnyHTMLFontFamilyDeclaration] {
        guard let res = Bundle.main.resourceURL.flatMap({ FileURL(url: $0) }) else { return [] }
        func file(_ name: String) -> FileURL { res.appendingPath(name, isDirectory: false) }
        return [
            CSSFontFamilyDeclaration(fontFamily: .literata, fontFaces: [
                CSSFontFace(file: file("Literata.ttf"), style: .normal, weight: .variable(200...900)),
                CSSFontFace(file: file("Literata-Italic.ttf"), style: .italic, weight: .variable(200...900)),
            ]).eraseToAnyHTMLFontFamilyDeclaration(),
            CSSFontFamilyDeclaration(fontFamily: .atkinsonHyperlegible, fontFaces: [
                CSSFontFace(file: file("AtkinsonHyperlegible-Regular.ttf"), style: .normal, weight: .standard(.normal)),
                CSSFontFace(file: file("AtkinsonHyperlegible-Bold.ttf"), style: .normal, weight: .standard(.bold)),
                CSSFontFace(file: file("AtkinsonHyperlegible-Italic.ttf"), style: .italic, weight: .standard(.normal)),
                CSSFontFace(file: file("AtkinsonHyperlegible-BoldItalic.ttf"), style: .italic, weight: .standard(.bold)),
            ]).eraseToAnyHTMLFontFamilyDeclaration(),
        ]
    }
}
