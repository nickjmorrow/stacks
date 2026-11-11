// Theme tokens. Midnight Sun is copied from that color theme's palette.json (a test checks they match
// where the file exists); Paper is Stacks' own light theme for daytime reading; Night is its warm, low-blue theme for reading in the dark.

public struct ThemeTokens: Equatable, Sendable {
    public var background: String
    public var surface: String
    public var raised: String
    public var line: String
    public var text: String
    public var dim: String
    public var faint: String
    public var accent: String
}

public enum Palette {
    public static let midnight = ThemeTokens(
        background: "#0b1120", surface: "#0f172a", raised: "#18233d", line: "#22304f",
        text: "#e3e8f2", dim: "#9aa8c2", faint: "#6b7a96", accent: "#ffcc33")

    /// Three colours for the home-screen widget: black, white, and one muted gold (#b6a255).
    /// Soft tones are the gold at partial opacity.
    public static let marigold = ThemeTokens(
        background: "#000000", surface: "#000000", raised: "#000000", line: "#b6a255",
        text: "#ffffff", dim: "#b6a255", faint: "#b6a255", accent: "#b6a255")

    /// Late-night reading: warm brown-blacks and parchment text, no blue, and softer contrast than Midnight Sun.
    public static let night = ThemeTokens(
        background: "#0f0a07", surface: "#171009", raised: "#231a10", line: "#35281a",
        text: "#bea27a", dim: "#8c7655", faint: "#5e4e38", accent: "#c98a35")

    public static let paper = ThemeTokens(
        background: "#f6f1e7", surface: "#efe8da", raised: "#e6dccb", line: "#d6cab4",
        text: "#2b2a27", dim: "#6f6a60", faint: "#9a9385", accent: "#b8860b")

    /// Highlight tints, readable on both themes.
    public static let highlight: [HighlightColor: String] = [
        .yellow: "#ffcc33", .blue: "#6ea8ff", .green: "#7ee0a1", .pink: "#ff8fb1", .purple: "#c792ea",
    ]
}
