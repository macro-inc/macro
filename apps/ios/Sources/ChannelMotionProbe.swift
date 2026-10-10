#if DEBUG
import UIKit

/// Opt-in, fixture-only diagnostics sampled during touch tracking and deceleration.
/// Unlike an XCTest accessibility snapshot, a display-link sample does not wait
/// until the scroll view and its hosted SwiftUI layers have stopped moving.
@MainActor
final class NativeChannelMotionProbe: NSObject {
    private static var associationKey: UInt8 = 0
    private weak var table: UITableView?
    private weak var composer: UIView?
    private var maximumKeyboardContentOverlap: CGFloat = 0
    private let report = UILabel()
    private let proxy = DisplayLinkProxy()
    private var displayLink: CADisplayLink?
    private var started = CACurrentMediaTime()
    private var lastTime: CFTimeInterval = 0
    private var lastOffset: CGFloat = 0
    private var lastPublish: CFTimeInterval = 0
    private var frames: [[String: Any]] = []
    private var samples = 0
    private var movingSamples = 0
    private var draggingSamples = 0
    private var deceleratingSamples = 0
    private var overlapSamples = 0
    private var geometryAnimationSamples = 0
    private var contentOverflowSamples = 0
    private var hasTrackedTouch = false
    private var maxOverlap: CGFloat = 0
    private var maxLayerDisplacement: CGFloat = 0
    private var maxFrameGapMs: Double = 0
    private var maxOffsetStep: CGFloat = 0
    private var settledRows: [[String: Any]] = []
    private var minimumKeyboardTop: CGFloat = .greatestFiniteMagnitude
    private var keyboardPartialDraggingSamples = 0
    private var keyboardDismissMode = ""
    private var keyboardDragPositions = Set<Int>()
    private let traceQueue = DispatchQueue(label: "com.macro.native.motion-trace", qos: .utility)

    static func install(on table: UITableView, composer: UIView) {
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--ui-testing"), arguments.contains("--test-channel-motion") else { return }
        let probe = NativeChannelMotionProbe(table: table, composer: composer)
        objc_setAssociatedObject(table, &associationKey, probe, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    private init(table: UITableView, composer: UIView) {
        self.table = table; self.composer = composer
        super.init()
        report.accessibilityIdentifier = "channel-motion-report"
        report.accessibilityLabel = "Channel motion diagnostics"
        report.isAccessibilityElement = true
        report.text = "Motion"
        report.textColor = .clear
        report.font = .systemFont(ofSize: 1)
        report.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        report.isUserInteractionEnabled = false
        table.superview?.addSubview(report)
        proxy.owner = self
        let link = CADisplayLink(target: proxy, selector: #selector(DisplayLinkProxy.tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    deinit { displayLink?.invalidate() }

    private func sample(_ link: CADisplayLink) {
        guard let table, table.window != nil, !table.isHidden, !table.visibleCells.isEmpty else { return }
        let time = link.timestamp
        let offset = table.contentOffset.y
        let moving = table.isDragging || table.isDecelerating
        let keyboardTop = table.superview?.keyboardLayoutGuide.layoutFrame.minY ?? 0
        let viewportHeight = table.superview?.bounds.height ?? 0
        if keyboardTop > 0 { minimumKeyboardTop = min(minimumKeyboardTop, keyboardTop) }
        keyboardDismissMode = table.keyboardDismissMode == .interactive ? "interactive" : "other"
        if table.isDragging, minimumKeyboardTop < viewportHeight - 150,
           keyboardTop > minimumKeyboardTop + 25, keyboardTop < viewportHeight - 70 {
            keyboardPartialDraggingSamples += 1
            keyboardDragPositions.insert(Int(keyboardTop / 8))
        }
        if table.isDragging { hasTrackedTouch = true }
        let readableBounds = table.bounds.inset(by: table.adjustedContentInset)
        let cells = table.visibleCells.filter { ($0.layer.presentation()?.frame ?? $0.frame).intersects(readableBounds) }.sorted { $0.frame.minY < $1.frame.minY }
        let rectangles = cells.map { $0.layer.presentation()?.frame ?? $0.frame }
        if table.isDragging, keyboardTop < viewportHeight - 70, let composer, !composer.isHidden,
           let lastPath = table.indexPathsForVisibleRows?.max(), lastPath.row == table.numberOfRows(inSection: lastPath.section) - 1 {
            let lastBottom = table.rectForRow(at: lastPath).maxY - offset
            maximumKeyboardContentOverlap = max(maximumKeyboardContentOverlap, lastBottom - composer.frame.minY)
        }
        let readableRectangles = rectangles.map { $0.intersection(readableBounds) }
        let overlap = zip(readableRectangles, readableRectangles.dropFirst()).map { max(0, $0.maxY - $1.minY) }.max() ?? 0
        var animations: [String] = []
        var displacement: CGFloat = 0
        for cell in cells { inspect(cell.layer, path: cell.accessibilityIdentifier ?? "row", animations: &animations, displacement: &displacement) }
        samples += 1
        if moving { movingSamples += 1 }
        if table.isDragging { draggingSamples += 1 }
        if table.isDecelerating { deceleratingSamples += 1 }
        if overlap > 1 { overlapSamples += 1 }
        if hasTrackedTouch, !animations.isEmpty, displacement > 1 { geometryAnimationSamples += 1 }
        let overflow = cells.map { max(0, $0.contentView.bounds.height - $0.bounds.height) }.max() ?? 0
        if hasTrackedTouch, overflow > 1 { contentOverflowSamples += 1 }
        maxOverlap = max(maxOverlap, overlap)
        maxLayerDisplacement = max(maxLayerDisplacement, displacement)
        if lastTime > 0 {
            maxFrameGapMs = max(maxFrameGapMs, (time - lastTime) * 1_000)
            if moving { maxOffsetStep = max(maxOffsetStep, abs(offset - lastOffset)) }
        }
        let rows: [[String: Any]] = zip(cells, rectangles).map { cell, rect in
            ["id": cell.accessibilityIdentifier ?? "", "y": rect.minY - offset, "height": rect.height,
                "modelHeight": cell.bounds.height, "contentHeight": cell.contentView.bounds.height]
        }
        if frames.count < 7_200 {
            frames.append(["time": time - started, "offset": offset, "height": table.contentSize.height,
                "dragging": table.isDragging, "decelerating": table.isDecelerating, "rows": rows,
                "overlap": overlap, "layerDisplacement": displacement, "animations": animations,
                "inheritedAnimationDuration": UIView.inheritedAnimationDuration,
                "keyboardTop": keyboardTop, "composerTop": composer?.frame.minY ?? 0, "tableHeight": table.bounds.height])
        }
        lastTime = time; lastOffset = offset
        guard time - lastPublish > 0.25 else { return }
        lastPublish = time
        if !moving, samples % 120 < 16 {
            settledRows = cells.map { cell in
                let fitted = cell.contentView.systemLayoutSizeFitting(CGSize(width: cell.contentView.bounds.width, height: UIView.layoutFittingCompressedSize.height),
                    withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
                let cellFitted = cell.systemLayoutSizeFitting(CGSize(width: cell.bounds.width, height: UIView.layoutFittingCompressedSize.height),
                    withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
                return ["id": cell.accessibilityIdentifier ?? "", "cellHeight": cell.bounds.height,
                    "contentHeight": cell.contentView.bounds.height, "fittedHeight": fitted.height, "cellFittedHeight": cellFitted.height,
                    "cellSafeTop": cell.safeAreaInsets.top, "cellSafeBottom": cell.safeAreaInsets.bottom,
                    "contentSafeTop": cell.contentView.safeAreaInsets.top, "contentSafeBottom": cell.contentView.safeAreaInsets.bottom,
                    "cellMarginsTop": cell.layoutMargins.top, "contentMarginsTop": cell.contentView.layoutMargins.top,
                    "subviews": cell.subviews.map { view -> [String: Any] in
                        ["type": String(describing: type(of: view)), "height": view.bounds.height, "y": view.frame.minY,
                            "safeTop": view.safeAreaInsets.top, "safeBottom": view.safeAreaInsets.bottom,
                            "children": view.subviews.map { ["type": String(describing: type(of: $0)), "height": $0.bounds.height,
                                "safeTop": $0.safeAreaInsets.top, "safeBottom": $0.safeAreaInsets.bottom] }]
                    }]
            }
        }
        let summary: [String: Any] = ["samples": samples, "movingSamples": movingSamples,
            "draggingSamples": draggingSamples, "deceleratingSamples": deceleratingSamples,
            "overlapSamples": overlapSamples, "geometryAnimationSamples": geometryAnimationSamples,
            "contentOverflowSamples": contentOverflowSamples,
            "maxOverlap": maxOverlap, "maxLayerDisplacement": maxLayerDisplacement,
            "maxFrameGapMs": maxFrameGapMs, "maxOffsetStep": maxOffsetStep,
            "offset": offset, "contentHeight": table.contentSize.height, "visibleRows": rows,
            "keyboardDismissMode": keyboardDismissMode, "maximumKeyboardContentOverlap": maximumKeyboardContentOverlap,
            "keyboardTop": keyboardTop, "viewportHeight": viewportHeight, "minimumKeyboardTop": minimumKeyboardTop, "keyboardPartialDraggingSamples": keyboardPartialDraggingSamples,
            "keyboardDragPositions": keyboardDragPositions.count,
            "bottomDistance": max(0, table.contentSize.height + table.adjustedContentInset.bottom - table.bounds.height - offset)]
        if let data = try? JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys]) {
            report.accessibilityValue = String(data: data, encoding: .utf8)
        }
        if samples % 120 < 16 {
            let payload: [String: Any] = ["summary": summary, "frames": frames, "settledRows": settledRows]
            let path = FileManager.default.temporaryDirectory.appendingPathComponent("channel-motion.json")
            traceQueue.async {
                if let data = try? JSONSerialization.data(withJSONObject: payload) { try? data.write(to: path, options: .atomic) }
            }
        }
    }

    private func inspect(_ layer: CALayer, path: String, animations: inout [String], displacement: inout CGFloat) {
        for key in layer.animationKeys() ?? [] {
            let animation = layer.animation(forKey: key)
            let keyPath = (animation as? CAPropertyAnimation)?.keyPath ?? key
            if ["position", "bounds", "transform"].contains(where: keyPath.contains) {
                animations.append(path + ":" + keyPath)
                if let visible = layer.presentation() {
                    displacement = [displacement, abs(visible.position.x - layer.position.x), abs(visible.position.y - layer.position.y),
                        abs(visible.bounds.width - layer.bounds.width), abs(visible.bounds.height - layer.bounds.height)].max() ?? displacement
                }
            }
        }
        for (index, child) in (layer.sublayers ?? []).enumerated() {
            inspect(child, path: path + "/" + String(index), animations: &animations, displacement: &displacement)
        }
    }

    @MainActor
    private final class DisplayLinkProxy: NSObject {
        weak var owner: NativeChannelMotionProbe?
        @objc func tick(_ link: CADisplayLink) { owner?.sample(link) }
    }
}
#endif
