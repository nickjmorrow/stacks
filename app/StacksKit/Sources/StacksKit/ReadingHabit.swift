// The reading habit: minutes per day from the reading log, the streak and the week strip.
// Pure functions of the sessions, the goal and "now", so the widget can recompute them at midnight.

import Foundation

public struct HabitDay: Equatable, Sendable {
    /// "yyyy-MM-dd"
    public var key: String
    /// M T W T F S S
    public var letter: String
    /// 0 to 1: today's (or a past day's) minutes against the goal; 0 for a future day.
    public var fill: Double
    public var isToday: Bool
    public var isFuture: Bool
}

public enum ReadingHabit {
    public static let defaultGoalMinutes = 5

    /// The local calendar day, as "yyyy-MM-dd".
    public static func dayKey(_ date: Date, calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Active seconds per local day, from every device. A session counts on the day it ended.
    public static func secondsByDay(_ sessions: [Session], calendar: Calendar) -> [String: Int] {
        var days: [String: Int] = [:]
        for s in sessions {
            let key = dayKey(Date(timeIntervalSince1970: Double(s.endedAt) / 1000), calendar: calendar)
            days[key, default: 0] += s.activeSeconds
        }
        return days
    }

    public static func minutesToday(_ days: [String: Int], now: Date, calendar: Calendar) -> Int {
        (days[dayKey(now, calendar: calendar)] ?? 0) / 60
    }

    /// Consecutive days that reached the goal. Counts back from today when today has reached it, else from
    /// yesterday, so a day still in progress never breaks the streak. Days after today are ignored.
    public static func streak(_ days: [String: Int], goalMinutes: Int, now: Date, calendar: Calendar) -> Int {
        let goal = max(goalMinutes, 1) * 60
        var day = now
        if (days[dayKey(day, calendar: calendar)] ?? 0) < goal {
            day = calendar.date(byAdding: .day, value: -1, to: day) ?? day
        }
        var count = 0
        while (days[dayKey(day, calendar: calendar)] ?? 0) >= goal {
            count += 1
            guard let before = calendar.date(byAdding: .day, value: -1, to: day) else { break }
            day = before
        }
        return count
    }

    /// This calendar week, Monday first.
    public static func week(_ days: [String: Int], goalMinutes: Int, now: Date, calendar: Calendar) -> [HabitDay] {
        let goal = Double(max(goalMinutes, 1) * 60)
        let today = dayKey(now, calendar: calendar)
        let sinceMonday = (calendar.component(.weekday, from: now) + 5) % 7 // Sunday is 1
        let monday = calendar.date(byAdding: .day, value: -sinceMonday, to: now) ?? now
        let letters = ["M", "T", "W", "T", "F", "S", "S"]
        return (0..<7).map { i in
            let date = calendar.date(byAdding: .day, value: i, to: monday) ?? monday
            let key = dayKey(date, calendar: calendar)
            let future = key > today
            return HabitDay(key: key, letter: letters[i], fill: future ? 0 : min(Double(days[key] ?? 0) / goal, 1),
                            isToday: key == today, isFuture: future)
        }
    }

    /// The next local midnight (a day can be 23 or 25 hours long).
    public static func nextMidnight(after date: Date, calendar: Calendar) -> Date {
        calendar.nextDate(after: date, matching: DateComponents(hour: 0, minute: 0, second: 0), matchingPolicy: .nextTime)
            ?? date.addingTimeInterval(86_400)
    }
}
