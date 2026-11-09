package com.macro.editor

import android.app.Activity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.ListView
import android.widget.TextView
import com.macro.editor.bridge.Action
import org.junit.Assert.*
import org.junit.Test
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeEditorMenuTest {
    @Test fun sourceRejectionReleasesOnlyThePendingRowAndKeepsUnavailablePeopleVisible() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        try {
            val activity = controller.get()
            NativeMenuScenario.run(activity, attach = { view ->
                activity.setContentView(view)
                view.measure(View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(240, View.MeasureSpec.EXACTLY))
                view.layout(0, 0, 320, 240)
                view.requestFocus()
            }, afterRows = { view, reply, events ->
                val first = requireNotNull(shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow).contentView as ListView
                requireNotNull(first.onItemClickListener).onItemClick(first, TextView(activity), 0, 0)
                assertEquals(1, events.count { it.action == Action.Select })
                view.menuRows(reply.copy(rejectedRowID = "first", rows = reply.rows.map { it.copy(disabled = true) }))
                val reopened = requireNotNull(shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow)
                assertTrue(reopened.isShowing)
                assertTrue(view.onKeyDown(android.view.KeyEvent.KEYCODE_ENTER,
                    android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_ENTER)))
                assertEquals(1, events.count { it.action == Action.Select })
            })
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun tappingAResultEndsImeCompositionBeforeTheGuardedInsertion() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        try {
            val activity = controller.get()
            NativeMenuScenario.run(activity, attach = { view ->
                activity.setContentView(view)
                view.measure(View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(240, View.MeasureSpec.EXACTLY))
                view.layout(0, 0, 320, 240)
                view.requestFocus()
            }, afterRows = { view, _, events ->
                val input = requireNotNull(view.onCreateInputConnection(EditorInfo()))
                assertTrue(input.setComposingRegion(0, 1))
                val window = requireNotNull(shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow)
                val list = window.contentView as ListView
                requireNotNull(list.onItemClickListener).onItemClick(list, TextView(activity), 0, 0)
                assertEquals(1, events.count { it.action == Action.Select })
            })
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun dismissedPopupCannotSelectTheRowOfItsReplacement() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        try {
            val activity = controller.get()
            NativeMenuScenario.run(activity, attach = { view ->
                activity.setContentView(view)
                view.measure(View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(240, View.MeasureSpec.EXACTLY))
                view.layout(0, 0, 320, 240)
                view.requestFocus()
            }, afterRows = { view, reply, events ->
                val window = requireNotNull(shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow)
                assertTrue(window.isShowing)
                val oldList = window.contentView as ListView
                val queuedTap = requireNotNull(oldList.onItemClickListener)
                view.menuRows(reply.copy(rows = reply.rows.map { it.copy(id = "new-${it.id}") }))
                val count = events.count { it.action == Action.Select }
                queuedTap.onItemClick(oldList, TextView(activity), 0, 0)
                assertEquals(count, events.count { it.action == Action.Select })
            })
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun nativePopupSelectionUsesGuardedRealSessionAndRejectsStaleReplies() {
        NativeMenuScenario.run(RuntimeEnvironment.getApplication())
    }
}
