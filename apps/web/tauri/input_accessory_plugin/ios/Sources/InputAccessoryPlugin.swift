import UIKit
import WebKit
import Tauri

class InputAccessoryPlugin: Plugin {
    private static var isSwizzled = false

    override public func load(webview: WKWebView) {
        webview.scrollView.keyboardDismissMode = .interactive

        guard !InputAccessoryPlugin.isSwizzled else { return }
        if disableAccessoryBar(in: webview) {
            InputAccessoryPlugin.isSwizzled = true
        }
    }
}

@discardableResult
private func disableAccessoryBar(in rootView: UIView) -> Bool {
    var queue = rootView.subviews
    while !queue.isEmpty {
        let view = queue.removeFirst()
        if NSStringFromClass(type(of: view)).hasPrefix("WKContent") {
            if let cls = object_getClass(view) {
                swizzleInputAccessoryView(on: cls)
                return true
            }
            return false
        }
        queue.append(contentsOf: view.subviews)
    }
    return false
}

private class NoInputAccessoryView: UIView {
    override var inputAccessoryView: UIView? { return nil }
}

private func swizzleInputAccessoryView(on cls: AnyClass) {
    let selector = #selector(getter: UIResponder.inputAccessoryView)
    guard let noAccessoryMethod = class_getInstanceMethod(
        NoInputAccessoryView.self,
        #selector(getter: NoInputAccessoryView.inputAccessoryView)
    ) else { return }

    let added = class_addMethod(
        cls,
        selector,
        method_getImplementation(noAccessoryMethod),
        method_getTypeEncoding(noAccessoryMethod)
    )

    if !added {
        class_replaceMethod(
            cls,
            selector,
            method_getImplementation(noAccessoryMethod),
            method_getTypeEncoding(noAccessoryMethod)
        )
    }
}

@_cdecl("init_plugin_input_accessory")
func initPlugin() -> Plugin {
    return InputAccessoryPlugin()
}
