package com.macro.call

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Real notification actions and activity lifecycle, without a backend or media credentials. */
@RunWith(AndroidJUnit4::class)
class IncomingCallPresentationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val manager = context.getSystemService(NotificationManager::class.java)

    private fun shell(command: String): String = ParcelFileDescriptor.AutoCloseInputStream(
        instrumentation.uiAutomation.executeShellCommand(command)).bufferedReader().use { it.readText() }

    @Before fun setup() {
        context.getSharedPreferences("macro_push", Context.MODE_PRIVATE).edit().putString("recipient", "call-test-user").commit()
        if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
        instrumentation.runOnMainSync { Calls.end(context) }
    }

    @After fun cleanup() {
        instrumentation.runOnMainSync { Calls.end(context) }
        if (Build.VERSION.SDK_INT >= 34) shell("appops set ${context.packageName} USE_FULL_SCREEN_INTENT default")
        shell("input keyevent 224")
        shell("input keyevent 4")
        context.getSharedPreferences("macro_push", Context.MODE_PRIVATE).edit().clear().commit()
    }

    private fun receive(id: String) {
        val payload = JSONObject().apply {
            put("callId", id); put("channelId", "call-preview-channel")
            put("channelName", "Design team"); put("callerName", "Test caller")
            put("livekitServerUrl", "wss://unused.invalid"); put("livekitToken", "test-token")
            put("ringStatusUrl", "https://unavailable-call-test.macro.com/status")
        }
        instrumentation.runOnMainSync {
            Calls.receive(context, mapOf("recipientId" to "call-test-user", "payload" to payload.toString()), System.currentTimeMillis())
        }
        instrumentation.awaitCondition("Incoming notification was not posted") {
            manager.activeNotifications.any { it.id == CallService.NOTIFICATION_ID }
        }
    }

    private fun notification(): Notification = manager.activeNotifications.single { it.id == CallService.NOTIFICATION_ID }.notification

    private fun answerNode(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (root == null) return null
        if (root.text?.contains("Answer") == true || root.contentDescription?.contains("Answer") == true) {
            var action: AccessibilityNodeInfo = root
            while (!action.isClickable) action = action.parent ?: return null
            return action
        }
        for (index in 0 until root.childCount) answerNode(root.getChild(index))?.let { return it }
        return null
    }

    @Test fun lockedIncomingCallOpensFullScreenAndBackKeepsTheRing() {
        assumeTrue(Build.VERSION.SDK_INT >= 34)
        shell("appops set ${context.packageName} USE_FULL_SCREEN_INTENT allow")
        shell("input keyevent 223")
        val monitor = instrumentation.addMonitor(CallActivity::class.java.name, null, false)
        try {
            val id = UUID.randomUUID().toString()
            receive(id)
            val activity = monitor.waitForActivityWithTimeout(10_000) as? CallActivity
            assertNotNull("A locked screen with full-screen access must open the incoming activity", activity)
            instrumentation.waitForIdleSync()
            instrumentation.uiAutomation.waitForIdle(500, 5_000)
            instrumentation.screenshot("incoming-call-full-screen.png")
            instrumentation.runOnMainSync {
                assertNull(Calls.room)
                assertEquals(id, Calls.offer?.callId)
                activity!!.onBackPressed()
            }
            instrumentation.awaitCondition("Back did not close the incoming screen") { !CallActivity.isOpen }
            assertNotNull(notification().contentIntent)
            assertTrue(notification().actions.size >= 2)
            instrumentation.runOnMainSync {
                assertEquals("Back must leave the ring answerable", id, Calls.offer?.callId)
                Calls.end(context, id)
            }
            instrumentation.awaitCondition("Ending the ring left its notification") { manager.activeNotifications.isEmpty() }
        } finally { instrumentation.removeMonitor(monitor) }
    }

    @Test fun deniedFullScreenAccessKeepsAnswerAndMicrophonePermissionReachable() {
        assumeTrue(Build.VERSION.SDK_INT >= 34)
        assumeTrue(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
        shell("appops set ${context.packageName} USE_FULL_SCREEN_INTENT deny")
        shell("input keyevent 223")
        val id = UUID.randomUUID().toString()
        receive(id)
        assertFalse(manager.canUseFullScreenIntent())
        instrumentation.runOnMainSync {
            assertFalse("Denied full-screen access must leave presentation to Android's notification", CallActivity.isOpen)
            assertNull(Calls.room)
        }
        val incoming = notification()
        val answer = incoming.actions.single { it.actionIntent.isActivity }
        assertTrue("Answer must open the activity directly, without a notification trampoline", answer.actionIntent.isActivity)
        shell("input keyevent 224")
        instrumentation.uiAutomation.waitForIdle(500, 5_000)
        instrumentation.uiAutomation.executeAndWaitForEvent({
            assertTrue(instrumentation.uiAutomation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS))
        }, { event -> event.packageName == "com.android.systemui" &&
            event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED }, 5_000)
        instrumentation.uiAutomation.waitForIdle(500, 5_000)
        instrumentation.screenshot("incoming-call-notification-fallback.png")
        instrumentation.uiAutomation.serviceInfo = instrumentation.uiAutomation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        val monitor = instrumentation.addMonitor(CallActivity::class.java.name, null, false)
        try {
            val answerNode = instrumentation.uiAutomation.windows.firstNotNullOfOrNull { answerNode(it.root) }
            assertNotNull("The system notification must offer an Answer action", answerNode)
            assertTrue(answerNode!!.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            val activity = monitor.waitForActivityWithTimeout(10_000) as? CallActivity
            assertNotNull("Notification Answer must reach the call screen", activity)
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync {
                assertEquals(id, activity!!.intent.getStringExtra("answer"))
                val field = CallActivity::class.java.getDeclaredField("permissionCallId").apply { isAccessible = true }
                assertEquals("Answer must request microphone access for this ring", id, field.get(activity))
                assertNull(Calls.room)
            }
            instrumentation.uiAutomation.waitForIdle(500, 5_000)
            assertTrue("Microphone permission must be visible after notification Answer",
                instrumentation.uiAutomation.windows.any { it.root?.packageName?.toString()?.endsWith(".permissioncontroller") == true })
            instrumentation.screenshot("incoming-call-microphone-permission.png")
        } finally { instrumentation.removeMonitor(monitor) }
    }

    @Test fun staleNotificationActionsCannotAnswerOrDeclineAReplacementCall() {
        val old = UUID.randomUUID().toString()
        val next = UUID.randomUUID().toString()
        val staleAnswer = CallService.screen(context, old, answer = true)
        val staleDecline = CallService.action(context, "end", old)
        receive(next)
        val currentAnswer = CallService.screen(context, next, answer = true)
        val currentDecline = CallService.action(context, "end", next)
        assertNotEquals("Pending intents must retain their original call identity", staleAnswer, currentAnswer)
        assertNotEquals(staleDecline, currentDecline)
        val activity = instrumentation.startActivitySync(Intent(context, CallActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("answer", old)) as CallActivity
        instrumentation.waitForIdleSync()
        staleDecline.send()
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
            assertTrue("A stale Answer must close without requesting microphone access", activity.isFinishing || activity.isDestroyed)
            assertEquals(next, Calls.offer?.callId)
            assertNull(Calls.room)
        }
        currentDecline.send()
        instrumentation.awaitCondition("The current notification must still decline its call") { Calls.offer == null }
    }
}
