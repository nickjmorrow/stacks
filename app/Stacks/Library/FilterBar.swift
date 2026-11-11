// Status, one menu per tag group, and sort.

import SwiftUI
import StacksKit

struct FilterBar: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Menu {
                    ForEach(BookStatus.allCases, id: \.self) { s in
                        Toggle(s.label, isOn: Binding(
                            get: { model.filter.statuses.contains(s) },
                            set: { on in if on { model.filter.statuses.insert(s) } else { model.filter.statuses.remove(s) } }))
                    }
                } label: {
                    Pill(title: "Status", count: model.filter.statuses.count)
                }
                ForEach(model.groups, id: \.name) { group in
                    Menu {
                        ForEach(group.tags, id: \.self) { tag in
                            Toggle(tag, isOn: Binding(
                                get: { model.filter.tagsByGroup[group.name]?.contains(tag) ?? false },
                                set: { on in
                                    var picked = model.filter.tagsByGroup[group.name] ?? []
                                    if on { picked.insert(tag) } else { picked.remove(tag) }
                                    model.filter.tagsByGroup[group.name] = picked
                                }))
                        }
                    } label: {
                        Pill(title: group.name, count: model.filter.tagsByGroup[group.name]?.count ?? 0)
                    }
                }
                Menu {
                    Picker("Sort", selection: $model.filter.sort) {
                        ForEach(LibraryFilter.Sort.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                } label: {
                    Pill(title: model.filter.sort.label, count: 0, icon: "arrow.up.arrow.down")
                }
                if model.filter.isActive {
                    Button("Clear") {
                        model.filter.statuses = []
                        model.filter.tagsByGroup = [:]
                        model.filter.search = ""
                    }
                    .font(.subheadline)
                }
            }
            .padding(.horizontal)
        }
    }
}

struct Pill: View {
    let title: String
    let count: Int
    var icon: String = "chevron.down"

    var body: some View {
        HStack(spacing: 4) {
            Text(count > 0 ? "\(title) · \(count)" : title)
            Image(systemName: icon).font(.caption2)
        }
        .font(.subheadline)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foregroundStyle(count > 0 ? Ink.bg : Ink.text)
        .background(count > 0 ? Ink.sun : Ink.raised, in: Capsule())
    }
}
