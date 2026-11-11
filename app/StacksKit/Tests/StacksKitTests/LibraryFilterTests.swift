import Foundation
import Testing
@testable import StacksKit

func book(_ id: String, _ title: String, status: BookStatus = .want, tags: [String] = [], author: String? = nil, year: Int? = nil,
          rating: Int? = nil, rec: String? = nil, added: Int64 = 0, lastRead: Int64? = nil, summary: String? = nil) -> LibraryBook {
    LibraryBook(bookId: id, pageId: "p-\(id)", pageTitle: title, name: title, status: status, tags: tags, rating: rating, rec: rec,
                finished: nil, progress: nil, year: year, genre: nil, summary: summary, author: author, format: .epub, fileSize: 1,
                fileSha256: "s", coverUrl: nil, isbn: nil, appleBooksId: nil, addedAt: added, lookupState: "done",
                lastReadAt: lastRead, pendingEdit: false)
}

let TAGS = [TagInfo(title: "Gothic", group: "Vibe", count: 2), TagInfo(title: "Cozy", group: "Vibe", count: 1),
            TagInfo(title: "Read with Alice", group: "With", count: 1), TagInfo(title: "Loose", group: nil, count: 1)]
let BOOKS = [
    book("1", "Dracula", status: .done, tags: ["Gothic"], author: "Bram Stoker", year: 1897, rating: 5, added: 1, lastRead: 10),
    book("2", "Cien años de soledad", status: .doing, tags: ["Cozy", "Read with Alice"], author: "Gabriel García Márquez", year: 1967, added: 2, lastRead: 30),
    book("3", "The Haunting of Hill House", status: .doing, tags: ["Gothic", "Read with Alice"], author: "Shirley Jackson", year: 1959, rating: 4, rec: "Alice", added: 3, lastRead: 20),
    book("4", "Atomic Habits", status: .want, author: "James Clear", added: 4, summary: "Small changes."),
]

@Test func twoPicksInOneGroupMeanEither() {
    var f = LibraryFilter()
    f.tagsByGroup = ["Vibe": ["Gothic", "Cozy"]]
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId).sorted() == ["1", "2", "3"])
}

@Test func picksAcrossGroupsMustAllMatch() {
    var f = LibraryFilter()
    f.tagsByGroup = ["Vibe": ["Gothic"], "With": ["Read with Alice"]]
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["3"])
}

@Test func statusFilter() {
    var f = LibraryFilter()
    f.statuses = [.doing]
    #expect(Set(f.apply(BOOKS, tags: TAGS).map(\.bookId)) == ["2", "3"])
}

@Test func searchIgnoresCaseAndAccentsAndCoversAuthorRecTagsAndSummary() {
    var f = LibraryFilter()
    f.search = "garcia marquez"
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["2"])
    f.search = "alice"
    #expect(Set(f.apply(BOOKS, tags: TAGS).map(\.bookId)) == ["2", "3"])
    f.search = "small changes"
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["4"])
}

@Test func sortOrders() {
    var f = LibraryFilter()
    f.sort = .title
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["4", "2", "1", "3"]) // "The" is ignored
    f.sort = .year
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["2", "3", "1", "4"]) // newest first, unknown last
    f.sort = .rating
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["1", "3", "4", "2"]) // unrated by title
    f.sort = .added
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["4", "3", "2", "1"])
    f.sort = .recentlyRead
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["2", "3", "1", "4"])
    f.sort = .author
    #expect(f.apply(BOOKS, tags: TAGS).map(\.bookId) == ["4", "2", "3", "1"]) // by last name: Clear, García Márquez, Jackson, Stoker
}

@Test func readingNowIsBooksBeingReadMostRecentFirst() {
    #expect(LibraryFilter.readingNow(BOOKS).map(\.bookId) == ["2", "3"])
}

@Test func groupsListTagsByGroupWithOtherLast() {
    #expect(LibraryFilter.groups(TAGS).map(\.name) == ["Vibe", "With", "Other"])
    #expect(LibraryFilter.groups(TAGS).last?.tags == ["Loose"])
}

@Suite struct HaystackTests {
    @Test func searchWithPrebuiltHaystacksMatchesTheSlowPath() {
        let dune = book("b1", "Dune", tags: ["scifi"], author: "Frank Herbert")
        var f = LibraryFilter()
        f.search = "herbert sci"
        #expect(f.apply([dune], tags: [], haystacks: LibraryFilter.haystacks([dune])).count == 1)
        #expect(f.apply([dune], tags: []).count == 1)
    }
}
