import UIKit
import SwiftUI
import ObjectiveC

/// Keep UIKit's interactive transition, including its cancellation and velocity
/// behavior, while allowing a hidden navigation bar to use the public gestures.
@MainActor
enum NativeNavigationBackGestures {
    private static var associationKey: UInt8 = 0

    static func enable(in controller: UIViewController) {
        guard let navigation = controller.navigationController else { return }
        let coordinator: Coordinator
        if let existing = objc_getAssociatedObject(navigation, &associationKey) as? Coordinator {
            coordinator = existing
        } else {
            coordinator = Coordinator(navigation: navigation)
            objc_setAssociatedObject(navigation, &associationKey, coordinator, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        }
        coordinator.install()
    }

    private final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private weak var navigation: UINavigationController?
        private weak var originalEdgeDelegate: UIGestureRecognizerDelegate?
        private weak var originalContentDelegate: UIGestureRecognizerDelegate?
        private weak var contentGesture: UIGestureRecognizer?

        init(navigation: UINavigationController) { self.navigation = navigation }

        func install() {
            guard let navigation else { return }
            if let edge = navigation.interactivePopGestureRecognizer {
                if edge.delegate !== self { originalEdgeDelegate = edge.delegate }
                edge.delegate = self
                edge.isEnabled = true
            }
            if #available(iOS 26.0, *), let content = navigation.interactiveContentPopGestureRecognizer {
                if content.delegate !== self { originalContentDelegate = content.delegate }
                contentGesture = content
                content.delegate = self
                content.isEnabled = true
            }
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let navigation, navigation.viewControllers.count > 1,
                  navigation.transitionCoordinator == nil,
                  navigation.presentedViewController == nil else { return false }
            if let pan = gestureRecognizer as? UIPanGestureRecognizer {
                let velocity = pan.velocity(in: navigation.view)
                let direction: CGFloat = navigation.view.effectiveUserInterfaceLayoutDirection == .rightToLeft ? -1 : 1
                guard velocity.x * direction > 0, abs(velocity.x) > abs(velocity.y) else { return false }
            }
            return true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            if gestureRecognizer === contentGesture {
                // Keep cursor movement, control interaction, and horizontal
                // attachment scrolling inside their own native controls.
                var view = touch.view
                while let current = view {
                    if current is UIControl { return false }
                    if let editor = current as? UITextView, editor.isEditable { return false }
                    if let scroll = current as? UIScrollView,
                       scroll.contentSize.width > scroll.bounds.width + 1 { return false }
                    view = current.superview
                }
            }
            let original = gestureRecognizer === contentGesture ? originalContentDelegate : originalEdgeDelegate
            return original?.gestureRecognizer?(gestureRecognizer, shouldReceive: touch) ?? true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            guard gestureRecognizer === contentGesture,
                  otherGestureRecognizer !== navigation?.interactivePopGestureRecognizer else { return false }
            // The timeline's row and table recognizers also see a rightward
            // pan. Let them coexist with the native transition, while leaving
            // unrelated controls and recognizers with normal exclusivity.
            var view = otherGestureRecognizer.view
            while let current = view {
                if current is UITableView { return true }
                view = current.superview
            }
            return false
        }
    }
}

private struct NativeNavigationDetailVisibleActionKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    /// Reassert detail chrome after UIKit cancels an interactive pop. The
    /// revealed root can receive SwiftUI onAppear before the pop completes.
    var nativeNavigationDetailVisibleAction: () -> Void {
        get { self[NativeNavigationDetailVisibleActionKey.self] }
        set { self[NativeNavigationDetailVisibleActionKey.self] = newValue }
    }
}
