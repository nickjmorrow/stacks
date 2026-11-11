// SwiftUI colors from the theme tokens in StacksKit.

import SwiftUI
import StacksKit

extension Color {
    /// "#rrggbb"
    init(hex: String) {
        let v = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

extension UIColor {
    convenience init(hex: String) {
        let v = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }
}

/// The app's colors (the library is always Night; the reader has its own theme setting).
enum Ink {
    static let bg = Color(hex: Palette.night.background)
    static let surface = Color(hex: Palette.night.surface)
    static let raised = Color(hex: Palette.night.raised)
    static let line = Color(hex: Palette.night.line)
    static let text = Color(hex: Palette.night.text)
    static let dim = Color(hex: Palette.night.dim)
    static let faint = Color(hex: Palette.night.faint)
    static let sun = Color(hex: Palette.night.accent)
    /// Errors, warm so they don't glare.
    static let danger = Color(hex: "#e0806a")
}
