package com.macro.editor

import android.text.SpannableStringBuilder
import android.text.style.LeadingMarginSpan
import com.macro.documentsession.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EditorListIndentTest {
    @Test fun nestedListMarginsUseTopologyAndParagraphsKeepRawIndent() {
        val root = KeyParts(0u, 0u)
        val keys = (1..11).map { KeyParts(it.toUInt(), 0u) }
        val projection = EditorProjection()
        projection.registerTypes(listOf(
            FfiTypeRow(1u, "list", NodeKind.ELEMENT, null),
            FfiTypeRow(2u, "listitem", NodeKind.ELEMENT, null),
            FfiTypeRow(3u, "paragraph", NodeKind.ELEMENT, null),
            FfiTypeRow(4u, "text", NodeKind.TEXT, null),
        ))
        val raw = FfiElementProps(ElementFormat.UNSET, 0u, null, 0u, "", "")
        val paragraph = raw.copy(indent = 2u)
        projection.apply(Diff(0u, true, null, decoratorKeys = emptyList(), ops = listOf(
            DiffOp.CreateElement(keys[0], 1u, raw, emptyList()),
            DiffOp.CreateElement(keys[1], 2u, raw, emptyList()),
            DiffOp.CreateText(keys[2], 4u, "a", FfiTextProps(0u, TextMode.NORMAL, 0u, ""), emptyList()),
            DiffOp.CreateElement(keys[3], 1u, raw, emptyList()),
            DiffOp.CreateElement(keys[4], 2u, raw, emptyList()),
            DiffOp.CreateText(keys[5], 4u, "b", FfiTextProps(0u, TextMode.NORMAL, 0u, ""), emptyList()),
            DiffOp.CreateElement(keys[6], 1u, raw, emptyList()),
            DiffOp.CreateElement(keys[7], 2u, raw, emptyList()),
            DiffOp.CreateText(keys[8], 4u, "c", FfiTextProps(0u, TextMode.NORMAL, 0u, ""), emptyList()),
            DiffOp.CreateElement(keys[9], 3u, paragraph, emptyList()),
            DiffOp.CreateText(keys[10], 4u, "p", FfiTextProps(0u, TextMode.NORMAL, 0u, ""), emptyList()),
            DiffOp.Children(keys[7], listOf(keys[8])),
            DiffOp.Children(keys[6], listOf(keys[7])),
            DiffOp.Children(keys[4], listOf(keys[5], keys[6])),
            DiffOp.Children(keys[3], listOf(keys[4])),
            DiffOp.Children(keys[1], listOf(keys[2], keys[3])),
            DiffOp.Children(keys[0], listOf(keys[1])),
            DiffOp.Children(keys[9], listOf(keys[10])),
            DiffOp.Children(root, listOf(keys[0], keys[9])),
        )))
        val layout = projection.layout()
        assertEquals("abc\np", layout.text)
        assertEquals(mapOf(keys[1] to 0u, keys[4] to 1u, keys[7] to 2u), layout.listDepths)
        val text = SpannableStringBuilder(layout.text)
        val spans = EditorSpans()
        spans.apply(text, projection, layout)
        val margins = text.getSpans(0, text.length, LeadingMarginSpan.Standard::class.java)
            .map { Triple(text.getSpanStart(it), text.getSpanEnd(it), it.getLeadingMargin(true)) }
            .sortedWith(compareBy({ it.first }, { it.second }, { it.third }))
        // These are the previous virtual-indent margins: levels 1/2 -> 24/48 px.
        assertEquals(listOf(Triple(1, 3, 24), Triple(2, 3, 48), Triple(4, 5, 48)), margins)
        assertEquals(0u, projection.nodes.getValue(keys[7]).elementProps?.indent)
        assertEquals(2u, projection.nodes.getValue(keys[9]).elementProps?.indent)

        // A received child-topology change updates depth without any indent-property write.
        projection.apply(Diff(0u, false, null, decoratorKeys = emptyList(), ops = listOf(
            DiffOp.Children(keys[4], listOf(keys[5])),
            DiffOp.Children(keys[0], listOf(keys[1], keys[7])),
            DiffOp.Remove(keys[6], true),
        )))
        val reparented = projection.layout()
        assertEquals("ab\nc\np", reparented.text)
        assertEquals(mapOf(keys[1] to 0u, keys[4] to 1u, keys[7] to 0u), reparented.listDepths)
        val nextText = SpannableStringBuilder(reparented.text)
        EditorSpans().apply(nextText, projection, reparented)
        val nextMargins = nextText.getSpans(0, nextText.length, LeadingMarginSpan.Standard::class.java)
            .map { Triple(nextText.getSpanStart(it), nextText.getSpanEnd(it), it.getLeadingMargin(true)) }
            .sortedWith(compareBy({ it.first }, { it.second }, { it.third }))
        assertEquals(listOf(Triple(1, 2, 24), Triple(5, 6, 48)), nextMargins)
    }
}
