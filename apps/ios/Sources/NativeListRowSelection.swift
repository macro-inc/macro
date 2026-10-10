import SwiftUI

/// The content keeps its gutter; the pressed/selected surface fills the list row.
/// Retain `selected` until navigation returns so a slow destination still gives
/// immediate feedback without replacing the row with a loading indicator.
struct NativeListRowButtonStyle: ButtonStyle {
    var selected: Bool
    var leading: CGFloat = 24
    var trailing: CGFloat = 16

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, leading).padding(.trailing, trailing)
            .contentShape(Rectangle())
            .background(selected || configuration.isPressed ? Color(uiColor: .systemGray4) : .clear)
            .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}
