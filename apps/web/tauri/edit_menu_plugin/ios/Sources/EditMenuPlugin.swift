import UIKit
import WebKit
import Tauri

private struct SetNativeMenuSuppressedArgs: Decodable {
    let suppressed: Bool
}

/// Suppresses the native text-selection edit menu (Copy | Look Up | Share …)
/// while the in-app selection popup is showing, so the two don't stack.
///
/// iOS (16+) assembles the edit menu through the responder chain's
/// `buildMenu(with:)`. WKWebView offers no delegate for customizing it — the
/// `editMenuForTextIn:` delegate is UITextView-only — so, like
/// InputAccessoryPlugin, this swizzles an override onto WebKit's content view
/// class (the first responder during text selection) that strips the system
/// menus whenever the frontend has flagged suppression. Selection handles,
/// the magnifier, dictation, and hardware-keyboard shortcuts (which build
/// through `UIMenuSystem.main`) are unaffected.
class EditMenuPlugin: Plugin {
    fileprivate static var suppressNativeEditMenu = false
    fileprivate static weak var contentView: UIView?
    private static var isSwizzled = false

    override public func load(webview: WKWebView) {
        guard let contentView = findContentView(in: webview) else { return }
        EditMenuPlugin.contentView = contentView
        if !EditMenuPlugin.isSwizzled, let cls = object_getClass(contentView),
            swizzleBuildMenu(on: cls)
        {
            EditMenuPlugin.isSwizzled = true
        }
    }

    @objc public func setNativeMenuSuppressed(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(SetNativeMenuSuppressedArgs.self)
        EditMenuPlugin.suppressNativeEditMenu = args.suppressed
        if args.suppressed {
            // The flag only gates the next `buildMenu` pass; a menu that
            // presented before it crossed the JS→native bridge is already
            // on screen and must be taken down explicitly.
            DispatchQueue.main.async {
                dismissPresentedEditMenu()
            }
        }
        invoke.resolve()
    }
}

private func findContentView(in rootView: UIView) -> UIView? {
    var queue = rootView.subviews
    while !queue.isEmpty {
        let view = queue.removeFirst()
        if NSStringFromClass(type(of: view)).hasPrefix("WKContent") {
            return view
        }
        queue.append(contentsOf: view.subviews)
    }
    return nil
}

private func dismissPresentedEditMenu() {
    if #available(iOS 16.0, *) {
        // WKContentView presents the modern edit menu through a
        // UIEditMenuInteraction it adds to itself.
        for interaction in EditMenuPlugin.contentView?.interactions ?? [] {
            (interaction as? UIEditMenuInteraction)?.dismissMenu()
        }
    } else {
        UIMenuController.shared.hideMenu()
    }
}

private typealias BuildMenuIMP = @convention(c) (AnyObject, Selector, UIMenuBuilder) -> Void

private func swizzleBuildMenu(on cls: AnyClass) -> Bool {
    let selector = #selector(UIResponder.buildMenu(with:))
    guard let method = class_getInstanceMethod(cls, selector) else { return false }
    let inheritedIMP = method_getImplementation(method)
    var replacedIMP: IMP?

    let overrideBlock: @convention(block) (AnyObject, UIMenuBuilder) -> Void = { target, builder in
        let original = unsafeBitCast(replacedIMP ?? inheritedIMP, to: BuildMenuIMP.self)
        original(target, selector, builder)
        guard
            EditMenuPlugin.suppressNativeEditMenu,
            builder.system !== UIMenuSystem.main
        else { return }
        removeEditMenus(from: builder)
    }

    // If the content view class implements `buildMenu` itself, the original
    // implementation is swapped in place (and returned for chaining);
    // otherwise an override is added and the inherited implementation is
    // chained instead.
    replacedIMP = class_replaceMethod(
        cls,
        selector,
        imp_implementationWithBlock(overrideBlock),
        method_getTypeEncoding(method)
    )
    return true
}

private func removeEditMenus(from builder: UIMenuBuilder) {
    // Known edit-menu groups as of iOS 18; new OS releases can introduce more
    // (e.g. Writing Tools), so expect an occasional device pass to extend
    // this list.
    var identifiers: [UIMenu.Identifier] = [
        .standardEdit,     // Cut / Copy / Paste
        .lookup,           // Look Up / Search Web / Translate
        .share,
        .replace,          // autocorrect "Replace…"
        .learn,
        .textStyle,        // Bold / Italics / Underline
        .spelling,
        .substitutions,
        .transformations,
        .speech,           // Speak / Spell Out
    ]
    if #available(iOS 16.0, *) {
        identifiers.append(.find)
    }
    if #available(iOS 17.0, *) {
        identifiers.append(.autoFill)
    }
    for identifier in identifiers {
        builder.remove(menu: identifier)
    }
}

@_cdecl("init_plugin_edit_menu")
func initPlugin() -> Plugin {
    return EditMenuPlugin()
}
