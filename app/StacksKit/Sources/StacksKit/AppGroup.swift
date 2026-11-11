// The shared container the app and its share extension both use.
// iPhone and iPad use an iOS app group, which the provisioning profile grants. On the Mac (Catalyst),
// macOS only lets an app into a group container its profile authorizes, and Xcode signs the Mac build
// with the wildcard team profile, which has no app groups. So the Mac uses a team-prefixed group,
// which the code signature's team ID authorizes on its own.

public enum AppGroup {
    #if targetEnvironment(macCatalyst)
    public static let id = "ZXYW4ZP89B.com.nicholai.stacks"
    #else
    public static let id = "group.com.nicholai.stacks"
    #endif
}
