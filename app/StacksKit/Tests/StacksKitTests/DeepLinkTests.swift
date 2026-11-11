import Foundation
import Testing
@testable import StacksKit

@Suite struct DeepLinkTests {
    @Test func parsesBookAndLibraryLinks() {
        #expect(DeepLink(url: URL(string: "stacks://book/abc")!) == .book("abc"))
        #expect(DeepLink(url: URL(string: "stacks://library")!) == .library)
    }

    @Test func refusesEverythingElse() {
        #expect(DeepLink(url: URL(string: "https://x/book/abc")!) == nil)
        #expect(DeepLink(url: URL(string: "stacks://book/")!) == nil)
        #expect(DeepLink(url: URL(string: "stacks://other")!) == nil)
    }

    @Test func buildsALinkThatParsesBack() {
        #expect(DeepLink(url: DeepLink.url(book: "b 1")) == .book("b 1"))
    }
}
