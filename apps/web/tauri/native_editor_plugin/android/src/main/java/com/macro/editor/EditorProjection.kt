package com.macro.editor

import com.macro.documentsession.*

/** Keyed view state. The Rust session is the only editor model. */
internal class EditorProjection {
    data class Node(
        val key: NodeKey,
        val kind: NodeKind,
        val type: UShort,
        var text: String = "",
        var textProps: TextProps? = null,
        var elementProps: ElementProps? = null,
        var props: SerializedNode? = null,
        var state: SerializedNode? = null,
        var children: List<NodeKey> = emptyList(),
    )

    data class Range(val key: NodeKey, val start: Int, val end: Int)
    data class Layout(
        val text: String,
        val ranges: List<Range>,
        val elements: List<Range>,
        val boundaries: Map<NodeKey, List<Int>>,
    ) {
        fun point(offset: Int): Point {
            require(offset in 0..text.length)
            val range = ranges.firstOrNull { offset >= it.start && offset <= it.end }
            if (range != null) return Point.Text(range.key, (offset - range.start).toUInt())
            val element = elements.firstOrNull { offset >= it.start && offset <= it.end }
            val key = element?.key ?: KeyParts(0u, 0u)
            val index = boundaries[key]?.indexOfLast { it <= offset }?.coerceAtLeast(0) ?: 0
            return Point.Element(key, index.toUInt())
        }

        fun offset(point: Point): Int? = when (point) {
            is Point.Text -> ranges.firstOrNull { it.key == point.key }?.let {
                val position = point.offset.toLong()
                if (position <= it.end - it.start) it.start + position.toInt() else null
            }
            is Point.Element -> boundaries[point.key]?.getOrNull(point.offset.toInt())
        }

        fun selection(anchor: Int, focus: Int): ViewSelection = ViewSelection.Range(
            point(anchor), point(focus), false,
        )
    }

    private val root = KeyParts(0u, 0u)
    val nodes = linkedMapOf<NodeKey, Node>()
    private val types = mutableMapOf<UShort, String>()

    fun registerTypes(rows: List<FfiTypeRow>) {
        types.clear()
        rows.forEach { types[it.index] = it.name }
    }

    fun typeName(node: Node): String? = types[node.type]

    fun apply(diff: Diff, displayedText: Pair<NodeKey, String>? = null) {
        if (diff.fullReconcile) nodes.clear()
        for (op in diff.ops) {
            when (op) {
                is DiffOp.CreateElement -> nodes[op.key] = Node(
                    op.key, NodeKind.ELEMENT, op.typeIndex, elementProps = op.base, props = op.props,
                )
                is DiffOp.CreateText -> nodes[op.key] = Node(
                    op.key, NodeKind.TEXT, op.typeIndex, op.text, op.base, props = op.props,
                )
                is DiffOp.CreateDecorator -> nodes[op.key] = Node(
                    op.key, NodeKind.DECORATOR, op.typeIndex, props = op.props,
                )
                is DiffOp.CreateLineBreak -> nodes[op.key] = Node(
                    op.key, NodeKind.LINE_BREAK, op.typeIndex, "\n",
                )
                is DiffOp.Remove -> nodes.remove(op.key)
                is DiffOp.Children -> {
                    // Root may be implicit in the initial patch.
                    if (op.parent == root && root !in nodes) {
                        nodes[root] = Node(root, NodeKind.ELEMENT, 0u)
                    }
                    requireNotNull(nodes[op.parent]).children = op.children
                }
                is DiffOp.Text -> requireNotNull(nodes[op.key]).text = op.text
                is DiffOp.TextProps -> requireNotNull(nodes[op.key]).textProps = op.props
                is DiffOp.ElementProps -> requireNotNull(nodes[op.key]).elementProps = op.props
                is DiffOp.NodeProps -> requireNotNull(nodes[op.key]).props = op.props
                is DiffOp.State -> requireNotNull(nodes[op.key]).state = op.state
            }
        }
        diff.viewTextMatches?.let { key ->
            require(displayedText?.first == key) { "Missing acknowledged native text" }
            requireNotNull(nodes[key]).text = requireNotNull(displayedText).second
        }
    }

    fun acceptDisplayedText(key: NodeKey, text: String) {
        requireNotNull(nodes[key]).text = text
    }

    fun layout(): Layout {
        val text = StringBuilder()
        val ranges = mutableListOf<Range>()
        val elements = mutableListOf<Range>()
        val boundaries = linkedMapOf<NodeKey, List<Int>>()
        fun append(key: NodeKey) {
            val node = requireNotNull(nodes[key])
            val start = text.length
            when (node.kind) {
                NodeKind.TEXT -> {
                    text.append(node.text)
                    ranges += Range(key, start, text.length)
                }
                NodeKind.LINE_BREAK -> text.append('\n')
                NodeKind.DECORATOR -> text.append('\uFFFC')
                NodeKind.ELEMENT -> {
                    val childOffsets = mutableListOf<Int>()
                    node.children.forEachIndexed { index, child ->
                        if (index > 0) {
                            when (typeName(node)) {
                                "tablerow" -> text.append('\t')
                                "root", "list", "table" -> text.append('\n')
                                else -> if (key == root) text.append('\n')
                            }
                        }
                        childOffsets += text.length
                        append(child)
                    }
                    childOffsets += text.length
                    boundaries[key] = childOffsets
                    elements += Range(key, start, text.length)
                }
            }
        }
        if (root in nodes) append(root)
        return Layout(text.toString(), ranges, elements, boundaries)
    }
}
