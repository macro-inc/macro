package com.macro.editor

import android.content.Intent
import android.view.KeyEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeEditorWindowTest {
    @Test fun accessibilityTextAndPhysicalUndoUseTheRustSession() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent = Intent(instrumentation.context, NativeEditorTestActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ActivityScenario.launch<NativeEditorTestActivity>(intent).use { activity ->
            val device = UiDevice.getInstance(instrumentation)
            device.waitForIdle()
            val editor = requireNotNull(device.findObject(By.desc("Native editor fixture")))
            editor.text = "window😀"
            instrumentation.waitForIdleSync()
            assertEquals("window😀", editor.text)
            activity.onActivity {
                assertNull(it.failure)
                assertEquals("window😀", it.textContent())
            }
            assertTrue(device.pressKeyCode(KeyEvent.KEYCODE_Z, KeyEvent.META_CTRL_ON))
            instrumentation.waitForIdleSync()
            assertEquals("", editor.text)
            activity.onActivity {
                assertNull(it.failure)
                assertEquals("", it.textContent())
                assertTrue(it.canRedo)
            }
            assertTrue(device.pressKeyCode(KeyEvent.KEYCODE_Z, KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON))
            instrumentation.waitForIdleSync()
            assertEquals("window😀", editor.text)
            activity.onActivity {
                assertNull(it.failure)
                assertEquals("window😀", it.textContent())
                assertFalse(it.canRedo)
            }
        }
    }
}
