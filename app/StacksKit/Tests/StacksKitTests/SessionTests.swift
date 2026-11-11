import Foundation
import Testing
@testable import StacksKit

let t0 = Date(timeIntervalSince1970: 1_800_000_000)
func at(_ s: Double) -> Date { t0.addingTimeInterval(s) }

@Test func everyTurnYieldsTheSessionToSave() {
    var t = SessionTracker(bookId: "b1", device: "iPhone-1a2b", start: 0.10, at: t0)
    let s = t.turn(to: 0.11, at: at(40))
    #expect(s?.activeSeconds == 40)
    #expect(s?.pagesTurned == 1)
    #expect(s?.startProgression == 0.10)
    #expect(s?.endProgression == 0.11)
    #expect(s?.startedAt == Int64(t0.timeIntervalSince1970 * 1000))
    #expect(s?.endedAt == Int64(at(40).timeIntervalSince1970 * 1000))
}

@Test func aGapOverThreeMinutesStartsANewSession() {
    var t = SessionTracker(bookId: "b1", device: "iPhone-1a2b", start: 0.1, at: t0)
    let first = t.turn(to: 0.11, at: at(60))
    #expect(t.turn(to: 0.12, at: at(60 + 600)) == nil) // the new session has no time yet
    let next = t.turn(to: 0.13, at: at(60 + 600 + 30))
    #expect(next != nil && next?.sessionId != first?.sessionId)
    #expect(next?.activeSeconds == 30)
    #expect(next?.startProgression == 0.11)
}

@Test func endDropsASessionUnderTwentySeconds() {
    var t = SessionTracker(bookId: "b1", device: "iPhone-1a2b", start: 0.1, at: t0)
    _ = t.turn(to: 0.11, at: at(10))
    #expect(t.end(at: at(15)) == nil)
}

@Test func endCountsTimeSinceTheLastTurnUpToTheIdleLimit() {
    var t = SessionTracker(bookId: "b1", device: "iPhone-1a2b", start: 0.1, at: t0)
    _ = t.turn(to: 0.11, at: at(100))
    #expect(t.end(at: at(160))?.activeSeconds == 160)
    var u = SessionTracker(bookId: "b1", device: "iPhone-1a2b", start: 0.1, at: t0)
    _ = u.turn(to: 0.11, at: at(100))
    #expect(u.end(at: at(100 + 3600))?.activeSeconds == 100) // left the book open for an hour
}

@Test func opensAtTheMostRecentPosition() {
    let mine = pos(device: "iPhone-1a2b", p: 0.5, at: 100)
    let ipad = pos(device: "iPad-9f9f", p: 0.3, at: 200)
    let r = PositionPolicy.open(all: [mine, ipad])
    #expect(r.start == ipad)
    #expect(r.offer == mine)
}

@Test func offersTheFurthestOnlyWhenOnePointOrMoreAhead() {
    let start = pos(device: "iPhone-1a2b", p: 0.500, at: 200)
    #expect(PositionPolicy.open(all: [start, pos(device: "iPad-9f9f", p: 0.505, at: 100)]).offer == nil)
    #expect(PositionPolicy.open(all: [start, pos(device: "iPad-9f9f", p: 0.52, at: 100)]).offer?.device == "iPad-9f9f")
    #expect(PositionPolicy.open(all: []).start == nil)
}

@Test func aSessionIsNotSavedUntilItReachesTwentySeconds() {
    var t = SessionTracker(bookId: "b1", device: "iPhone-1a2b", start: 0.1, at: t0)
    #expect(t.turn(to: 0.11, at: at(5)) == nil)
    #expect(t.turn(to: 0.12, at: at(25))?.activeSeconds == 25)
}
