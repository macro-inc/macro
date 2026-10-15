import SwiftUI

/// The production mobile menu unfolds individual glass pills from the New control.
struct NativeCreateMenu: View {
    let triggerFrame: CGRect
    let onClose: () -> Void
    let onSelect: (NativeTab?) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var remPoints: CGFloat = 17
    private var rem: CGFloat { remPoints / 16 }
    @State private var expanded = false
    @State private var closing = false
    private let choices: [NativeTab?] = [.email, .channels, .files, .calendar, .tasks, nil]

    var body: some View {
        GeometryReader { geometry in
            let bottom = triggerFrame == .zero ? 86 - geometry.safeAreaInsets.bottom : geometry.size.height - triggerFrame.maxY
            let right = triggerFrame == .zero ? 12 : max(12, geometry.size.width - triggerFrame.maxX)
            ZStack(alignment: .bottomTrailing) {
                Color.black.opacity(0.1)
                    .overlay { RadialGradient(colors: [MacroTheme.accent.opacity(0.06), MacroTheme.accent.opacity(0.02), .clear], center: UnitPoint(x: 0.5, y: -0.12), startRadius: 0, endRadius: geometry.size.height * 0.9) }
                    .ignoresSafeArea().contentShape(Rectangle()).onTapGesture { close() }
                    .opacity(expanded ? 1 : 0)
                    .accessibilityLabel("Dismiss create menu").accessibilityAddTraits(.isButton)
                VStack(alignment: .trailing, spacing: 12 * rem) {
                    ScrollView {
                        VStack(alignment: .trailing, spacing: 8 * rem) {
                            ForEach(Array(choices.enumerated()), id: \.offset) { index, tab in
                                Button { close(selection: tab, selected: true) } label: {
                                    HStack(spacing: 12 * rem) {
                                        MacroIcon(name: icon(tab), size: 22 * rem)
                                        Text(tab?.createTitle ?? "More")
                                    }.font(.system(size: 15 * rem, weight: .medium)).padding(.horizontal, 20 * rem).frame(height: 46).contentShape(Capsule())
                                }.buttonStyle(.plain).nativeGlass().accessibilityIdentifier("create-menu-" + (tab?.rawValue ?? "more"))
                                    .opacity(expanded ? 1 : 0)
                                    .scaleEffect(expanded ? 1 : closing ? 0.96 : 0.82, anchor: .trailing)
                                    .offset(y: expanded ? 0 : closing ? 12 : CGFloat(choices.count - index) * 54 + 4)
                                    .animation(reduceMotion ? nil : closing ? .easeIn(duration: 0.18) : .interpolatingSpring(duration: 0.36, bounce: 0.12).delay(Double(choices.count - index - 1) * 0.022), value: expanded)
                            }
                        }.frame(maxWidth: .infinity, alignment: .trailing)
                    }.scrollIndicators(.hidden).scrollClipDisabled()
                        .frame(width: 202 * rem, height: min(46 * 6 + 40 * rem, max(100, geometry.size.height - geometry.safeAreaInsets.top - bottom - 70)))
                    Button { close() } label: {
                        HStack(spacing: 6 * rem) {
                            MacroIcon(name: "plus", size: 22 * rem).rotationEffect(.degrees(expanded ? 45 : 0))
                            Text("New")
                        }.font(.system(size: 15 * rem, weight: .medium)).padding(.leading, 12 * rem).padding(.trailing, 16 * rem)
                            .frame(width: triggerFrame.width > 0 ? triggerFrame.width : nil, height: 46).contentShape(Capsule())
                    }.buttonStyle(.plain).nativeGlass().accessibilityLabel("Close create menu")
                        .animation(reduceMotion ? nil : .interpolatingSpring(duration: 0.32, bounce: 0.15), value: expanded)
                }.padding(.trailing, right).padding(.bottom, bottom)
            }.accessibilityAddTraits(.isModal)
                .onAppear { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) { expanded = true } }
        }
    }

    private func close(selection: NativeTab? = nil, selected: Bool = false) {
        guard !closing else { return }
        closing = true
        withAnimation(reduceMotion ? nil : .easeIn(duration: 0.18)) { expanded = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + (reduceMotion ? 0 : 0.18)) {
            onClose()
            if selected { onSelect(selection) }
        }
    }

    private func icon(_ tab: NativeTab?) -> String {
        switch tab { case .email: "envelope-simple"; case .channels: "chat-circle"; case .files: "file-text"; case .calendar: "calendar-blank"; case .tasks: "list-checks"; default: "dots-three" }
    }
}
