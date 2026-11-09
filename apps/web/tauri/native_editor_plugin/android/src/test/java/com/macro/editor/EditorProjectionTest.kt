package com.macro.editor

import com.macro.documentsession.*
import org.junit.Assert.*
import org.junit.Test

class EditorProjectionTest {
    @Test fun quoteFormattingRunsStayAdjacent() {
        val projection = EditorProjection()
        projection.registerTypes(listOf(FfiTypeRow(1u, "quote", NodeKind.ELEMENT, null)))
        val root = KeyParts(0u, 0u)
        val quote = KeyParts(0u, 1u)
        val first = KeyParts(0u, 2u)
        val second = KeyParts(0u, 3u)
        projection.apply(Diff(0u, true, null, listOf(
            DiffOp.CreateElement(quote, 1u, FfiElementProps(
                ElementFormat.UNSET, 0u, null, 0u, "", ""), emptyList()),
            DiffOp.CreateText(first, 2u, "a", FfiTextProps(1u, TextMode.NORMAL, 0u, ""), emptyList()),
            DiffOp.CreateText(second, 2u, "b", FfiTextProps(2u, TextMode.NORMAL, 0u, ""), emptyList()),
            DiffOp.Children(quote, listOf(first, second)),
            DiffOp.Children(root, listOf(quote)),
        )))
        val layout = projection.layout()
        assertEquals("ab", layout.text)
        assertEquals(1, layout.offset(Point.Text(second, 0u)))
        assertEquals(2, layout.offset(Point.Element(quote, 2u)))
    }

    @Test fun supplementaryCharactersAndBackwardSelectionUseUtf16() {
        val projection = EditorProjection()
        val root = KeyParts(0u, 0u)
        val paragraph = KeyParts(0u, 1u)
        val text = KeyParts(0u, 2u)
        projection.apply(Diff(0u, true, null, listOf(
            DiffOp.CreateElement(paragraph, 1u, FfiElementProps(
                ElementFormat.UNSET, 0u, null, 0u, "", ""), emptyList()),
            DiffOp.CreateText(text, 2u, "a😀b", FfiTextProps(0u, TextMode.NORMAL, 0u, ""), emptyList()),
            DiffOp.Children(paragraph, listOf(text)),
            DiffOp.Children(root, listOf(paragraph)),
        )))
        val layout = projection.layout()
        assertEquals("a😀b", layout.text)
        assertEquals(Point.Text(text, 3u), layout.point(3))
        assertEquals(3, layout.offset(Point.Text(text, 3u)))
        assertEquals(ViewSelection.Range(Point.Text(text, 4u), Point.Text(text, 1u), false),
            layout.selection(4, 1))
        assertNull(layout.offset(Point.Text(text, 5u)))
    }

    @Test fun removingAnAncestorPreservesAChildMovedToAnotherParagraph() {
        val projection = EditorProjection()
        val root = KeyParts(0u, 0u)
        val old = KeyParts(0u, 1u)
        val replacement = KeyParts(0u, 3u)
        val text = KeyParts(0u, 2u)
        val base = FfiElementProps(ElementFormat.UNSET, 0u, null, 0u, "", "")
        projection.apply(Diff(0u, true, null, listOf(
            DiffOp.CreateElement(old, 1u, base, emptyList()),
            DiffOp.CreateText(text, 2u, "kept", FfiTextProps(0u, TextMode.NORMAL, 0u, ""), emptyList()),
            DiffOp.Children(old, listOf(text)),
            DiffOp.Children(root, listOf(old)),
        )))
        projection.apply(Diff(0u, false, null, listOf(
            DiffOp.Remove(old, true),
            DiffOp.CreateElement(replacement, 1u, base, emptyList()),
            DiffOp.Children(replacement, listOf(text)),
            DiffOp.Children(root, listOf(replacement)),
        )))
        assertEquals("kept", projection.layout().text)
        assertEquals(4, projection.layout().offset(Point.Element(replacement, 1u)))
        assertFalse(projection.nodes.containsKey(old))
    }
    @Test fun decoratorCacheInvalidatesPropertiesAndNeverQueriesDetachedDescendants() {
        val projection = EditorProjection()
        val root = KeyParts(0u, 0u)
        val parent = KeyParts(0u, 1u)
        val mention = KeyParts(0u, 2u)
        projection.apply(Diff(0u, true, null, listOf(
            DiffOp.CreateElement(parent, 1u, FfiElementProps(ElementFormat.UNSET, 0u, null, 0u, "", ""), emptyList()),
            DiffOp.CreateDecorator(mention, 2u, emptyList()),
            DiffOp.Children(parent, listOf(mention)), DiffOp.Children(root, listOf(parent)),
        )))
        assertEquals(listOf(mention), projection.pendingDecorators())
        projection.installDecorators(listOf(FfiDecorator(mention, "@Person", true, true)))
        assertTrue(projection.pendingDecorators().isEmpty())
        assertEquals("\uFFFC", projection.layout().text)
        projection.apply(Diff(0u, false, null, listOf(DiffOp.NodeProps(mention, emptyList()))))
        assertEquals(listOf(mention), projection.pendingDecorators())
        projection.apply(Diff(0u, false, null, listOf(DiffOp.Remove(parent, true), DiffOp.Children(root, emptyList()))))
        assertTrue(projection.pendingDecorators().isEmpty())
        assertEquals("", projection.layout().text)
    }

}
