import SwiftUI
import UIKit

/// Original Phosphor vectors used by the Tauri mobile dock, at its fixed 27pt size.
struct MacroIcon: View {
    let name: String
    var size: CGFloat = 27
    var body: some View { Image("macro-" + name).renderingMode(.template).resizable().scaledToFit().frame(width: size, height: size).accessibilityHidden(true) }
}

extension NativeTab {
    func dockIcon(selected: Bool) -> String {
        switch self {
        case .home: selected ? "bell-fill" : "bell"
        case .calendar: selected ? "calendar-fill" : "calendar"
        case .email: selected ? "envelope-fill" : "envelope"
        case .channels: selected ? "hash-straight-fill" : "hash-straight"
        case .files: selected ? "files-fill" : "files"
        case .agents: selected ? "sparkle-fill" : "sparkle"
        case .tasks: "list-checks"
        case .calls: "phone-call"
        }
    }
}

private struct NativeChromeTopKey: EnvironmentKey { static let defaultValue: CGFloat = 0 }
private struct NativeChromeBottomKey: EnvironmentKey { static let defaultValue: CGFloat = 0 }
extension EnvironmentValues {
    var nativeChromeTop: CGFloat {
        get { self[NativeChromeTopKey.self] }
        set { self[NativeChromeTopKey.self] = newValue }
    }
    var nativeChromeBottom: CGFloat {
        get { self[NativeChromeBottomKey.self] }
        set { self[NativeChromeBottomKey.self] = newValue }
    }
}

private struct NativeChromeInset: ViewModifier {
    @Environment(\.nativeChromeBottom) private var bottom
    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: bottom).allowsHitTesting(false).accessibilityHidden(true) }
    }
}
extension View { func nativeChromeInset() -> some View { modifier(NativeChromeInset()) } }

struct MacroDockButtonStyle: ButtonStyle {
    let tab: NativeTab
    let selected: Bool
    var selectionNamespace: Namespace.ID? = nil
    var moving = false
    func makeBody(configuration: Configuration) -> some View {
        MacroIcon(name: tab.dockIcon(selected: selected || configuration.isPressed))
            .foregroundStyle(selected ? Color.white : .primary)
            .frame(width: 46, height: 46).contentShape(Circle())
            .background {
                if selected, let selectionNamespace {
                    Capsule().fill(.gray.opacity(moving ? 0 : 0.28))
                        .animation(.easeOut(duration: moving ? 0.07 : 0.18), value: moving)
                        .frame(width: 46, height: 40)
                        .matchedGeometryEffect(id: "dock-selection", in: selectionNamespace)
                        .accessibilityHidden(true).allowsHitTesting(false)
                }
            }
            .overlay {
                if selected, let selectionNamespace {
                    NativeDockMovingLens(moving: moving).frame(width: 46, height: 40)
                        .matchedGeometryEffect(id: "dock-moving-lens", in: selectionNamespace)
                        .accessibilityHidden(true).allowsHitTesting(false)
                }
            }
    }
}

/// The moving lens sits above the glyph, so the native glass samples the icon
/// below it. The resting gray pill remains behind the glyph and fades separately.
private struct NativeDockMovingLens: View {
    let moving: Bool
    var body: some View {
        Group {
        if #available(iOS 26, *) {
            Capsule().fill(.clear).glassEffect(.clear, in: Capsule())
        } else {
            Capsule().fill(.clear).background(.thinMaterial, in: Capsule())
                .overlay(Capsule().stroke(.white.opacity(0.22), lineWidth: 0.5))
        }
        }.scaleEffect(moving ? 1.18 : 1).opacity(moving ? 1 : 0)
            .animation(.spring(duration: moving ? 0.11 : 0.20, bounce: 0.10), value: moving)
    }
}

// UIImage's SVG natural size is256pt; explicitly rasterize at the chrome's point size.
extension MacroIcon {
    static func image(_ name: String, size: CGFloat) -> UIImage? {
        guard let source = UIImage(named: "macro-" + name) else { return nil }
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size)).image { _ in
            source.draw(in: CGRect(x: 0, y: 0, width: size, height: size))
        }.withRenderingMode(.alwaysTemplate)
    }
}
