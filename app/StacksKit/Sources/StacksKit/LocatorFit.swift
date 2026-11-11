// The server refuses a locator over 16 KB. A highlight spanning pages can carry that much text, so the
// text around it is dropped and the highlight itself shortened until the locator fits.

import Foundation

public enum LocatorFit {
    public static let limit = 15_000

    public static func fit(_ locator: JSONValue) -> JSONValue {
        guard locator.jsonString().utf8.count > limit, case .object(var obj) = locator else { return locator }
        if case .object(var text)? = obj["text"] {
            text["before"] = nil
            text["after"] = nil
            obj["text"] = .object(text)
            var budget = 10_000
            while JSONValue.object(obj).jsonString().utf8.count > limit, budget > 100, let h = text["highlight"]?.stringValue {
                text["highlight"] = .string(String(h.prefix(budget)))
                obj["text"] = .object(text)
                budget /= 2
            }
        }
        return .object(obj)
    }
}
