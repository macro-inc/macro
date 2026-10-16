package com.macro.call

import android.content.Context
import android.app.NotificationManager
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred

/** Exercises real Telecom/foreground service wiring without backend credentials. */
@RunWith(AndroidJUnit4::class)
class IncomingCallTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    @Before fun registerRecipient() {
        context.getSharedPreferences("macro_push", Context.MODE_PRIVATE).edit().putString("recipient", "call-test-user").commit()
        if (Build.VERSION.SDK_INT >= 33) {
            instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS").close()
        }
        instrumentation.runOnMainSync { Calls.end(context) }
    }

    @After fun cleanup() {
        instrumentation.runOnMainSync { Calls.end(context) }
        context.getSharedPreferences("macro_push", Context.MODE_PRIVATE).edit().clear().commit()
    }

    private fun data(id: String, recipient: String = "call-test-user") = mapOf(
        "recipientId" to recipient,
        "payload" to JSONObject().apply {
            put("callId", id)
            put("channelId", "call-test-channel")
            put("channelName", "Emulator call")
            put("livekitServerUrl", "wss://unused.invalid")
            put("livekitToken", "test-token")
            // An unavailable status endpoint must never authorize an answer.
            put("ringStatusUrl", "https://unavailable-call-test.macro.com/status")
        }.toString(),
    )

    @Test fun incomingTelecomConnectionDeclinesAndRejectsRedelivery() {
        val id = UUID.randomUUID().toString()
        instrumentation.runOnMainSync { Calls.receive(context, data(id), System.currentTimeMillis()) }
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            var connected = false
            instrumentation.runOnMainSync {
                connected = Calls.connection != null && context.getSystemService(NotificationManager::class.java)
                    .activeNotifications.any { it.id == CallService.NOTIFICATION_ID }
            }
            if (connected) break
            Thread.sleep(100)
        }
        instrumentation.runOnMainSync {
            assertEquals(id, Calls.offer?.callId)
            assertNotNull("Telecom must create the native connection", Calls.connection)
            val notification = context.getSystemService(NotificationManager::class.java)
                .activeNotifications.single { it.id == CallService.NOTIFICATION_ID }.notification
            assertTrue("Incoming notification must expose answer/decline", notification.actions.size >= 2)
            assertNull("Ringing must not start a media room", Calls.room)
            assertNull("Ringing must not restore an active web session", Calls.snapshot())
            Calls.connection!!.onReject()
            assertNull(Calls.offer)
            assertNull(Calls.connection)
            Calls.receive(context, data(id), System.currentTimeMillis())
            assertNull("Declined calls must not ring again", Calls.offer)
        }
    }

    @Test fun redeliveredStartRestoresServiceOwnershipAndCleansUpOnHangup() {
        val id = UUID.randomUUID().toString()
        val manager = context.getSystemService(NotificationManager::class.java)
        instrumentation.runOnMainSync { Calls.receive(context, data(id), System.currentTimeMillis()) }
        fun awaitCondition(message: String, condition: () -> Boolean) {
            val deadline = System.currentTimeMillis() + 10_000
            while (System.currentTimeMillis() < deadline) {
                var ready = false
                instrumentation.runOnMainSync { ready = condition() }
                if (ready) return
                Thread.sleep(100)
            }
            fail(message)
        }
        awaitCondition("Call service did not start") { CallService.instance != null }
        var service: CallService? = null
        instrumentation.runOnMainSync {
            service = CallService.instance
            // Model the ownership gap after stop() clears the pointer but before
            // Android destroys the service. Deliver a real start to that same object.
            CallService::class.java.getDeclaredField("instance").apply { isAccessible = true }.set(null, null)
            CallService.start(context)
        }
        awaitCondition("Redelivered start did not restore the live instance") { CallService.instance != null }
        instrumentation.runOnMainSync {
            assertSame("Android must reuse the existing service", service, CallService.instance)
            Calls.end(context, id)
        }
        awaitCondition("Hangup left a foreground call notification") {
            CallService.instance == null && manager.activeNotifications.none { it.id == CallService.NOTIFICATION_ID }
        }
        val mediaSession = CallService::class.java.getDeclaredField("mediaSession").apply { isAccessible = true }
        awaitCondition("Hangup did not release the service media session") { mediaSession.get(service) == null }
    }

    @Test fun endingBeforeServiceStartDoesNotCrashOrLeaveANotification() {
        val id = UUID.randomUUID().toString()
        instrumentation.runOnMainSync {
            Calls.receive(context, data(id), System.currentTimeMillis())
            // Queue the foreground service and decline in the same main-thread turn,
            // before Android can create/promote the service.
            CallService.start(context)
            Calls.end(context, id)
        }
        // Stay alive beyond Android's foreground-service deadline.
        Thread.sleep(12_000)
        instrumentation.runOnMainSync {
            assertNull(Calls.offer)
            assertNull(CallService.instance)
            assertFalse(context.getSystemService(NotificationManager::class.java)
                .activeNotifications.any { it.id == CallService.NOTIFICATION_ID })
            val next = UUID.randomUUID().toString()
            Calls.receive(context, data(next), System.currentTimeMillis())
            assertEquals("The process must still accept subsequent calls", next, Calls.offer?.callId)
            Calls.end(context, next)
        }
    }

    @Test fun telecomTeardownFailureStillRemovesNotificationAndAllowsAnotherCall() {
        val id = UUID.randomUUID().toString()
        val manager = context.getSystemService(NotificationManager::class.java)
        instrumentation.runOnMainSync { Calls.receive(context, data(id), System.currentTimeMillis()) }
        fun awaitNotification(expected: Boolean) {
            val deadline = System.currentTimeMillis() + 10_000
            while (System.currentTimeMillis() < deadline) {
                if (manager.activeNotifications.any { it.id == CallService.NOTIFICATION_ID } == expected) return
                Thread.sleep(100)
            }
            fail("Call notification visibility did not become $expected")
        }
        awaitNotification(true)
        var injected = false
        instrumentation.runOnMainSync {
            assertNotNull(Calls.connection)
            Calls.end(context, id) { injected = true; throw IllegalStateException("Simulated Telecom callback failure") }
            assertTrue("Fault must occur during actual Telecom teardown", injected)
            assertNull(Calls.offer)
            assertNull(Calls.connection)
            assertNull(Calls.snapshot())
        }
        awaitNotification(false)
        instrumentation.waitForIdleSync()
        val next = UUID.randomUUID().toString()
        instrumentation.runOnMainSync { Calls.receive(context, data(next), System.currentTimeMillis()) }
        awaitNotification(true)
        instrumentation.runOnMainSync {
            assertEquals("Failed cleanup must not prevent the next incoming call", next, Calls.offer?.callId)
            assertNotNull(Calls.connection)
            Calls.end(context, next)
        }
        awaitNotification(false)
    }

    @Test fun unrelatedRingHangupPreservesPendingJoin() {
        val ringId = UUID.randomUUID().toString()
        val outgoingId = UUID.randomUUID().toString()
        instrumentation.runOnMainSync {
            Calls.receive(context, data(ringId), System.currentTimeMillis())
            val lease = Calls.prepareJoin(context, "other-channel")
            try {
                Calls.end(context, ringId)
                Calls.outgoing(context, CallOffer(outgoingId, "other-channel", "Outgoing call",
                    "wss://unused.invalid", "test-token"), lease)
                assertEquals("Unrelated ring teardown must preserve the outgoing lease", outgoingId, Calls.offer?.callId)
            } finally {
                Calls.abortJoin(context, lease)
                Calls.end(context)
            }
        }
    }

    @Test fun microphonePermissionPausesExpiryThenRevalidatesCancellation() {
        val id = UUID.randomUUID().toString()
        instrumentation.runOnMainSync {
            Calls.receive(context, data(id), System.currentTimeMillis() - 59_000)
            assertTrue(Calls.beginMicrophonePermission(id))
        }
        Thread.sleep(2_000)
        instrumentation.runOnMainSync {
            assertEquals("Permission wait must not expire an otherwise valid ring", id, Calls.offer?.callId)
            Calls.finishMicrophonePermission(id)
            Calls.answer(context, id) { "ended" }
            assertNull("Permission completion must still revalidate remote cancellation", Calls.offer)
            assertNull(Calls.room)
        }
    }

    @Test fun duplicateAnswerIntentsPreservePendingPermissionAction() {
        val id = UUID.randomUUID().toString()
        instrumentation.runOnMainSync { Calls.receive(context, data(id), System.currentTimeMillis()) }
        val activity = instrumentation.startActivitySync(android.content.Intent(context, CallActivity::class.java)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) as CallActivity
        var completions = 0
        val originalAction: () -> Unit = { completions++ }
        val field = CallActivity::class.java.getDeclaredField("permissionAction").apply { isAccessible = true }
        val newIntent = CallActivity::class.java.getDeclaredMethod("onNewIntent", android.content.Intent::class.java).apply { isAccessible = true }
        instrumentation.runOnMainSync {
            // Model a platform permission request already in flight, without changing
            // process-wide permissions or depending on the system dialog's layout.
            field.set(activity, originalAction)
            CallActivity::class.java.getDeclaredField("permissionCallId").apply { isAccessible = true }.set(activity, id)
            assertTrue(Calls.beginMicrophonePermission(id))
            repeat(2) {
                newIntent.invoke(activity, android.content.Intent(context, CallActivity::class.java).putExtra("answer", id))
                assertSame("A duplicate intent must retain the original permission completion", originalAction, field.get(activity))
            }
            activity.onRequestPermissionsResult(99, emptyArray(), intArrayOf())
            assertSame("Unrelated permission results must not consume this request", originalAction, field.get(activity))
            activity.onRequestPermissionsResult(4, arrayOf(android.Manifest.permission.RECORD_AUDIO),
                intArrayOf(android.content.pm.PackageManager.PERMISSION_GRANTED))
            assertEquals(1, completions)
            assertNull(field.get(activity))
            activity.finish()
        }
    }

    @Test fun ignoresStaleAndOtherAccountOffers() {
        instrumentation.runOnMainSync {
            Calls.receive(context, data(UUID.randomUUID().toString(), "another-account"), System.currentTimeMillis())
            assertNull(Calls.offer)
            Calls.receive(context, data(UUID.randomUUID().toString()), System.currentTimeMillis() - 61_000)
            assertNull(Calls.offer)
            assertNull(Calls.room)
        }
    }

    @Test fun incomingWhileScreenOffKeepsNotificationActions() {
        instrumentation.uiAutomation.executeShellCommand("input keyevent 223").close()
        try {
            incomingTelecomConnectionDeclinesAndRejectsRedelivery()
        } finally {
            instrumentation.uiAutomation.executeShellCommand("input keyevent 224").close()
        }
    }

    @Test fun appJoinAdoptsRingingCallWithoutTreatingItsMembershipAsRemoteAnswer() {
        instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.RECORD_AUDIO").close()
        val id = UUID.randomUUID().toString()
        val status = CompletableDeferred<String?>()
        lateinit var lease: String
        instrumentation.runOnMainSync {
            Calls.receive(context, data(id), System.currentTimeMillis())
            Calls.answer(context, id) { status.await() }
            lease = Calls.prepareJoin(context, "call-test-channel")
        }
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline) {
            var ready = false
            instrumentation.runOnMainSync { ready = Calls.connection != null }
            if (ready) break
            Thread.sleep(100)
        }
        instrumentation.runOnMainSync {
            val connection = Calls.connection
            assertNotNull("Telecom must create the ringing connection before app adoption", connection)
            // The join API and its new token make the old verifier report answered.
            status.complete("answered")
            assertEquals(id, Calls.offer?.callId)
            Calls.outgoing(context, CallOffer(id, "call-test-channel", "Joined call", "wss://unused.invalid", "new-join-token"), lease)
            assertEquals(id, Calls.offer?.callId)
            assertEquals("new-join-token", Calls.offer?.token)
            assertSame("App Join must reuse the existing Telecom connection", connection, Calls.connection)
            assertNotNull("App Join must start native media instead of declining its own answer", Calls.room)
            assertNotNull(Calls.snapshot())
            Calls.abortJoin(context, lease)
            assertEquals("Committed cleanup must preserve the media session", id, Calls.offer?.callId)
            Calls.end(context, id)
        }
    }

    @Test fun incomingDuringPendingAppJoinCannotBeResolvedByOldRingPolling() {
        val id = UUID.randomUUID().toString()
        instrumentation.runOnMainSync {
            val lease = Calls.prepareJoin(context, "call-test-channel")
            Calls.receive(context, data(id), System.currentTimeMillis())
            Calls.answer(context, id) { "answered" }
            assertEquals(id, Calls.offer?.callId)
            Calls.abortJoin(context, lease)
            assertNull("Cancelling a pending join must release its arriving ring", Calls.offer)
            assertThrows(IllegalStateException::class.java) {
                Calls.outgoing(context, CallOffer(id, "call-test-channel", "Cancelled", "wss://unused.invalid", "token"), lease)
            }
            assertNull(Calls.room)
        }
    }

    @Test fun nullAccountResetPreservesUnassignedJoinAndCall() {
        instrumentation.runOnMainSync {
            context.getSharedPreferences("macro_push", Context.MODE_PRIVATE).edit().remove("recipient").commit()
            val lease = Calls.prepareJoin(context, "call-test-channel")
            val id = UUID.randomUUID().toString()
            try {
                Calls.resetRecipient(context, null)
                Calls.outgoing(context, CallOffer(id, "call-test-channel", "Unassigned account",
                    "wss://unused.invalid", "token"), lease)
                assertEquals("Null reset must preserve an unassigned lease", id, Calls.offer?.callId)
                Calls.resetRecipient(context, null)
                assertEquals("Null reset must preserve an unassigned active call", id, Calls.offer?.callId)
            } finally {
                Calls.abortJoin(context, lease)
                Calls.end(context)
            }
        }
    }

    @Test fun accountResetAbortsOnlyThatAccountsPendingJoin() {
        instrumentation.runOnMainSync {
            val oldLease = Calls.prepareJoin(context, "call-test-channel")
            Calls.resetRecipient(context, "call-test-user")
            assertThrows(IllegalStateException::class.java) {
                Calls.outgoing(context, CallOffer(UUID.randomUUID().toString(), "call-test-channel", "Old account", "wss://unused.invalid", "token"), oldLease)
            }
            context.getSharedPreferences("macro_push", Context.MODE_PRIVATE).edit().putString("recipient", "new-account").commit()
            val newLease = Calls.prepareJoin(context, "call-test-channel")
            Calls.resetRecipient(context, "call-test-user")
            Calls.receive(context, data(UUID.randomUUID().toString(), "new-account"), System.currentTimeMillis())
            assertNotNull("Old account's late reset must not abort a new lease", Calls.offer)
            Calls.abortJoin(context, newLease)
            assertNull(Calls.offer)
        }
    }

    @Test fun obsoleteAnswerCompletionCannotUnlockAnotherCallsAnswer() {
        val oldId = UUID.randomUUID().toString()
        val newId = UUID.randomUUID().toString()
        val oldStatus = CompletableDeferred<String?>()
        val newStatus = CompletableDeferred<String?>()
        var checks = 0
        try {
            instrumentation.runOnMainSync {
                Calls.receive(context, data(oldId), System.currentTimeMillis())
                Calls.answer(context, oldId) { oldStatus.await() }
                Calls.end(context, oldId)
            }
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync {
                Calls.receive(context, data(newId), System.currentTimeMillis())
                assertEquals(newId, Calls.offer?.callId)
                Calls.answer(context, newId) { checks++; newStatus.await() }
                oldStatus.complete("ringing")
                Calls.answer(context, newId) { checks++; "answered" }
                assertEquals("Old verification must not allow a duplicate answer check", 1, checks)
                assertEquals(newId, Calls.offer?.callId)
                assertNull(Calls.room)
                newStatus.complete("ended")
                assertNull(Calls.offer)
            }
        } finally {
            oldStatus.complete("ended"); newStatus.complete("ended")
        }
    }
}
