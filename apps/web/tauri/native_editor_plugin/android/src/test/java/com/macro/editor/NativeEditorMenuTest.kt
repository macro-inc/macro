package com.macro.editor

import android.app.Activity
import android.view.View
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
