// Times reading for the reading log. A session is reading with no pause longer than 3 minutes; time
// spent paused isn't counted. Every page turn yields the session so far, to be saved at once
// (an app killed mid-session loses at most the time since the last turn).

import Foundation

public struct SessionTracker: Sendable {
    public static let idleLimit: TimeInterval = 180
    public static let minimum: TimeInterval = 20

    let bookId: String
    let device: String
    private var sessionId = UUID().uuidString.lowercased()
    private var startedAt: Date
    private var lastActivity: Date
    private var active: TimeInterval = 0
    private var startProgression: Double
    private var endProgression: Double
    private var pages = 0

    public init(bookId: String, device: String, start progression: Double, at: Date) {
        self.bookId = bookId
        self.device = device
        startedAt = at
        lastActivity = at
        startProgression = progression
        endProgression = progression
    }

    /// A page turn (any location change). Returns the session to save, once it is long enough to keep.
    public mutating func turn(to progression: Double, at: Date) -> Session? {
        let gap = at.timeIntervalSince(lastActivity)
        if gap > Self.idleLimit {
            sessionId = UUID().uuidString.lowercased()
            startedAt = at
            active = 0
            pages = 0
            startProgression = endProgression
        } else if gap > 0 {
            active += gap
        }
        lastActivity = at
        endProgression = progression
        pages += 1
        return active >= Self.minimum ? current(endingAt: at) : nil
    }

    /// Closing the book or leaving the app. Nil when the session is too short to keep.
    public mutating func end(at: Date) -> Session? {
        let gap = at.timeIntervalSince(lastActivity)
        if gap > 0 && gap <= Self.idleLimit { active += gap }
        lastActivity = at
        guard active >= Self.minimum else { return nil }
        return current(endingAt: at)
    }

    private func current(endingAt end: Date) -> Session {
        Session(sessionId: sessionId, bookId: bookId, device: device, startedAt: ms(startedAt), endedAt: ms(end),
                activeSeconds: Int(active.rounded()), startProgression: startProgression, endProgression: endProgression,
                pagesTurned: pages)
    }
}

func ms(_ d: Date) -> Int64 { Int64((d.timeIntervalSince1970 * 1000).rounded()) }

/// Where to open a book, from every device's last position.
public enum PositionPolicy {
    public static let importDevice = "apple-books"

    /// Open where the reader was last (on any device); offer the furthest position when it's at least 1 point further.
    public static func open(all positions: [Position]) -> (start: Position?, offer: Position?) {
        // Apple Books' imported position only knows the chapter; once Stacks has a position of its own, it's ignored.
        let own = positions.filter { $0.device != importDevice }
        let all = own.isEmpty ? positions : own
        guard let start = all.max(by: { $0.updatedAt < $1.updatedAt }) else { return (nil, nil) }
        guard let furthest = all.max(by: { $0.progression < $1.progression }), furthest.progression - start.progression >= 0.01 else {
            return (start, nil)
        }
        return (start, furthest)
    }
}
