package com.macro.editor

import android.graphics.Typeface
import android.text.Spannable
import android.text.Spanned
import android.text.style.*
import com.macro.documentsession.*

/** Span application never replaces Editable or touches Android's composing/selection spans. */
internal class EditorSpans {
    private val installed = mutableListOf<Any>()

    fun apply(text: Spannable, projection: EditorProjection, layout: EditorProjection.Layout) {
        installed.forEach(text::removeSpan)
        installed.clear()
        fun span(value: Any, range: EditorProjection.Range) {
            if (range.start == range.end) return
            text.setSpan(value, range.start, range.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            installed += value
        }
        for (range in layout.ranges) {
            val format = projection.nodes[range.key]?.textProps?.format ?: 0u
            if (format and 1u != 0u) span(StyleSpan(Typeface.BOLD), range)
            if (format and 2u != 0u) span(StyleSpan(Typeface.ITALIC), range)
            if (format and 4u != 0u) span(StrikethroughSpan(), range)
            if (format and 8u != 0u) span(UnderlineSpan(), range)
            if (format and 16u != 0u) span(TypefaceSpan("monospace"), range)
            if (format and 32u != 0u) span(SubscriptSpan(), range)
            if (format and 64u != 0u) span(SuperscriptSpan(), range)
        }
        for (range in layout.decorators) {
            val node = requireNotNull(projection.nodes[range.key])
            val facts = node.decorator ?: continue
            if (facts.isInline && projection.typeName(node)?.endsWith("-mention") == true && facts.text.isNotEmpty())
                span(NativeDecoratorSpan(facts.text), range)
        }
        for (range in layout.elements) {
            val node = requireNotNull(projection.nodes[range.key])
            val type = projection.typeName(node)
            val tag = (node.props?.firstOrNull { it.key == "tag" }?.value as? FfiValue.Text)?.value
            when (type) {
                "heading" -> {
                    span(StyleSpan(Typeface.BOLD), range)
                    span(RelativeSizeSpan(when (tag) {
                        "h1" -> 2f
                        "h2" -> 1.5f
                        "h3" -> 1.25f
                        else -> 1.1f
                    }), range)
                }
                "quote" -> span(QuoteSpan(), range)
                "code", "custom-code" -> span(TypefaceSpan("monospace"), range)
            }
            node.elementProps?.let { props ->
                if (props.indent > 0u) span(LeadingMarginSpan.Standard(props.indent.toInt() * 24), range)
                when (props.format) {
                    ElementFormat.CENTER -> span(AlignmentSpan.Standard(android.text.Layout.Alignment.ALIGN_CENTER), range)
                    ElementFormat.RIGHT, ElementFormat.END -> span(AlignmentSpan.Standard(android.text.Layout.Alignment.ALIGN_OPPOSITE), range)
                    else -> Unit
                }
            }
        }
    }
}
