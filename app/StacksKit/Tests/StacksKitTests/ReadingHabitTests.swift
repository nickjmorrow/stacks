import Foundation
import Testing
@testable import StacksKit

let newYork: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "America/New_York")!
    return c
}()

func local(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12, _ min: Int = 0) -> Date {
    newYork.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
}

func habitSession(_ id: String, device: String = "iPhone-1", ended: Date, seconds: Int) -> Session {
    let end = Int64(ended.timeIntervalSince1970 * 1000)
    return Session(sessionId: id, bookId: "b1", device: device, startedAt: end - Int64(seconds) * 1000, endedAt: end,
                   activeSeconds: seconds, startProgression: 0.1, endProgression: 0.2, pagesTurned: 3)
}

@Suite struct ReadingHabitTests {
    // Friday 30 October 2026; Saturday 31st is the day before daylight saving ends (Sunday 1 November).
    let friday = local(2026, 10, 30)

    @Test func noSessionsGivesAnEmptyWeekAndZeroStreak() {
        #expect(ReadingHabit.streak([:], goalMinutes: 5, now: friday, calendar: newYork) == 0)
        let week = ReadingHabit.week([:], goalMinutes: 5, now: friday, calendar: newYork)
        #expect(week.count == 7)
        #expect(week.allSatisfy { $0.fill == 0 })
        #expect(week.filter(\.isToday).count == 1)
        #expect(ReadingHabit.minutesToday([:], now: friday, calendar: newYork) == 0)
    }

    @Test func sessionBelongsToTheDayItEnded() {
        let s = habitSession("s1", ended: local(2026, 10, 30, 0, 10), seconds: 1200) // started 23:50 on the 29th
        #expect(ReadingHabit.secondsByDay([s], calendar: newYork) == ["2026-10-30": 1200])
    }

    @Test func daysSumAcrossDevices() {
        let a = habitSession("s1", device: "iPhone-1", ended: local(2026, 10, 30, 8), seconds: 100)
        let b = habitSession("s2", device: "iPad-2", ended: local(2026, 10, 30, 21), seconds: 250)
        #expect(ReadingHabit.secondsByDay([a, b], calendar: newYork) == ["2026-10-30": 350])
    }

    @Test func streakCountsBackFromTodayWhenTodayReachedTheGoal() {
        let days = ["2026-10-27": 300, "2026-10-28": 300, "2026-10-29": 300, "2026-10-30": 300]
        #expect(ReadingHabit.streak(days, goalMinutes: 5, now: friday, calendar: newYork) == 4)
    }

    @Test func todayInProgressDoesNotBreakTheStreak() {
        let days = ["2026-10-27": 300, "2026-10-28": 300, "2026-10-29": 300, "2026-10-30": 180]
        #expect(ReadingHabit.streak(days, goalMinutes: 5, now: friday, calendar: newYork) == 3)
        #expect(ReadingHabit.minutesToday(days, now: friday, calendar: newYork) == 3)
    }

    @Test func aMissedDayEndsTheStreak() {
        let days = ["2026-10-28": 600, "2026-10-29": 120]
        #expect(ReadingHabit.streak(days, goalMinutes: 5, now: friday, calendar: newYork) == 0)
    }

    @Test func raisingTheGoalReJudgesPastDays() {
        let days = ["2026-10-27": 400, "2026-10-28": 400, "2026-10-29": 400]
        #expect(ReadingHabit.streak(days, goalMinutes: 5, now: friday, calendar: newYork) == 3)
        #expect(ReadingHabit.streak(days, goalMinutes: 10, now: friday, calendar: newYork) == 0)
    }

    @Test func futureDatedSessionNeverCounts() {
        let days = ["2026-10-29": 300, "2026-10-30": 300, "2026-10-31": 600]
        #expect(ReadingHabit.streak(days, goalMinutes: 5, now: friday, calendar: newYork) == 2)
        let saturday = ReadingHabit.week(days, goalMinutes: 5, now: friday, calendar: newYork)[5]
        #expect(saturday.key == "2026-10-31")
        #expect(saturday.isFuture)
        #expect(saturday.fill == 0)
    }

    @Test func weekIsMondayFirstWithFillCappedAtOne() {
        let saturday = local(2026, 10, 31)
        let days = ["2026-10-27": 900, "2026-10-31": 180]
        let week = ReadingHabit.week(days, goalMinutes: 5, now: saturday, calendar: newYork)
        #expect(week.map(\.key) == ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"])
        #expect(week.map(\.letter) == ["M", "T", "W", "T", "F", "S", "S"])
        #expect(week[1].fill == 1)
        #expect(abs(week[5].fill - 0.6) < 1e-9)
        #expect(week[5].isToday)
        #expect(week[6].isFuture)
        #expect(!week[4].isFuture)
    }

    @Test func weekAcrossTheDaylightSavingChangeStillHasSevenDays() {
        let week = ReadingHabit.week([:], goalMinutes: 5, now: local(2026, 11, 1), calendar: newYork)
        #expect(week.count == 7)
        #expect(week.first?.key == "2026-10-26")
        #expect(week.last?.isToday == true)
    }

    @Test func nextMidnightIsTheRealLocalMidnight() {
        let sat = local(2026, 10, 31, 15)
        let satNext = ReadingHabit.nextMidnight(after: sat, calendar: newYork)
        #expect(satNext == local(2026, 11, 1, 0))
        #expect(satNext.timeIntervalSince(sat) == 9 * 3600)
        // Sunday 1 November is 25 hours long: noon to midnight is 12 hours, and midnight is the 2nd, not 23:00 on the 1st.
        let sun = local(2026, 11, 1, 12)
        let sunNext = ReadingHabit.nextMidnight(after: sun, calendar: newYork)
        #expect(ReadingHabit.dayKey(sunNext, calendar: newYork) == "2026-11-02")
        #expect(sunNext.timeIntervalSince(sun) == 12 * 3600)
        #expect(newYork.component(.hour, from: sunNext) == 0)
        // From half past midnight, before the clocks go back at 02:00, the next midnight is 24.5 hours away, not 23.5.
        let early = local(2026, 11, 1, 0, 30)
        let earlyNext = ReadingHabit.nextMidnight(after: early, calendar: newYork)
        #expect(ReadingHabit.dayKey(earlyNext, calendar: newYork) == "2026-11-02")
        #expect(earlyNext.timeIntervalSince(early) == 24.5 * 3600)
    }
}
