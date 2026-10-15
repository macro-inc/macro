import SwiftUI
import UIKit

/// UIKit keeps controls in the floating inset's actual hit-test hierarchy.
/// SwiftUI-only gestures can otherwise fall through that inset to the transcript.
struct NativeAgentFooterButton: UIViewRepresentable {
    let image: String
    var isSymbol = false
    var pointSize: CGFloat = 21
    let title: String
    let identifier: String
    var enabled = true
    var tint: UIColor = .label
    var filled = false
    let action: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }
    func makeUIView(context: Context) -> Control {
        let button = Control(type: .system)
        button.addTarget(context.coordinator, action: #selector(Coordinator.activate), for: .touchUpInside)
        button.accessibilityIdentifier = identifier
        return button
    }
    func updateUIView(_ button: Control, context: Context) {
        context.coordinator.action = action
        let icon = isSymbol ? UIImage(systemName: image, withConfiguration: UIImage.SymbolConfiguration(pointSize: pointSize)) : MacroIcon.image(image, size: pointSize)
        button.setImage(icon, for: .normal)
        button.accessibilityLabel = title
        button.isEnabled = enabled
        button.tintColor = tint
        button.fillLayer.isHidden = !filled
        button.fillLayer.backgroundColor = UIColor.tertiarySystemFill.resolvedColor(with: button.traitCollection).cgColor
    }
    final class Control: UIButton {
        let fillLayer = CALayer()
        override init(frame: CGRect) {
            super.init(frame: frame)
            fillLayer.cornerRadius = 18
            layer.insertSublayer(fillLayer, at: 0)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func layoutSubviews() {
            super.layoutSubviews()
            fillLayer.frame = CGRect(x: (bounds.width - 36) / 2, y: (bounds.height - 36) / 2, width: 36, height: 36)
        }
    }
    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func activate() { action() }
    }
}

struct NativeAgentOutlineButton: UIViewRepresentable {
    let title: String
    var icon: String? = nil
    var identifier: String? = nil
    let action: () -> Void

    func makeCoordinator() -> NativeAgentFooterButton.Coordinator { .init(action: action) }
    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        button.addTarget(context.coordinator, action: #selector(NativeAgentFooterButton.Coordinator.activate), for: .touchUpInside)
        button.layer.cornerRadius = 19.125
        button.layer.borderWidth = 0.5
        return button
    }
    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.action = action
        var configuration = UIButton.Configuration.plain()
        configuration.title = title
        configuration.image = icon.flatMap { MacroIcon.image($0, size: 14.875) ?? UIImage(systemName: $0, withConfiguration: UIImage.SymbolConfiguration(pointSize: 14.875)) }
        configuration.imagePadding = 6.375
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 8.5, bottom: 6, trailing: 8.5)
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { original in
            var result = original; result.font = .systemFont(ofSize: 12.75, weight: .medium); return result
        }
        configuration.baseForegroundColor = .label
        button.configuration = configuration
        button.layer.borderColor = UIColor.separator.resolvedColor(with: button.traitCollection).cgColor
        button.accessibilityIdentifier = identifier
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIButton, context: Context) -> CGSize? {
        CGSize(width: uiView.intrinsicContentSize.width, height: max(38.25, uiView.intrinsicContentSize.height))
    }
}
