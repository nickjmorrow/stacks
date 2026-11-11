import Foundation
import Testing
@testable import StacksKit

@Test func midnightMatchesPaletteJSON() throws {
    let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Projects/dotfiles/themes/midnight-sun/palette.json")
    guard let data = try? Data(contentsOf: url) else { return } // only where that theme file exists
    let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    let surface = try #require(json["surface"] as? [String: String])
    let text = try #require(json["text"] as? [String: String])
    let accent = try #require(json["accent"] as? [String: String])
    let m = Palette.midnight
    #expect(m.background == surface["navy950"])
    #expect(m.surface == surface["navy900"])
    #expect(m.raised == surface["navy800"])
    #expect(m.line == surface["navy700"])
    #expect(m.text == text["primary"])
    #expect(m.dim == text["dim"])
    #expect(m.faint == text["faint"])
    #expect(m.accent == accent["sun"])
}

@Test func marigoldIsOnlyBlackGoldAndWhite() {
    // Gold is the only colour besides black and white.
    let m = Palette.marigold
    #expect(m.background == "#000000")
    #expect(m.text == "#ffffff")
    #expect(m.accent == "#b6a255")
    #expect(Set([m.background, m.surface, m.raised, m.line, m.text, m.dim, m.faint, m.accent]) == ["#000000", "#ffffff", "#b6a255"])
}

@Test func nightIsWarmWithNoBlue() {
    // Every token keeps red >= green >= blue, so nothing tips cool, and the text stays well short of white.
    let n = Palette.night
    for hex in [n.background, n.surface, n.raised, n.line, n.text, n.dim, n.faint, n.accent] {
        let v = UInt32(hex.dropFirst(), radix: 16)!
        let (r, g, b) = ((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)
        #expect(r >= g && g >= b, "\(hex) is not warm")
    }
    #expect(n.text == "#bea27a")
}
