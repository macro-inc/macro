package com.macro.editor

import com.macro.documentsession.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NativeSessionStorageTest {
    private val first = "00000000-0000-0000-0000-000000000011"
    private val second = "00000000-0000-0000-0000-000000000012"
    private val third = "00000000-0000-0000-0000-000000000013"
    private val observer = "00000000-0000-0000-0000-000000000014"
    @Test fun corruptDatabaseFilesArePreservedInsteadOfRecreated() {
        val context = RuntimeEnvironment.getApplication()
        NativeSessionStorage(context, "corrupt-file-fixture", first, "fixture-user").use { firstStore ->
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalAppend("corrupt-file-fixture", first,
                WalRecord(1uL, 1000L, "fixture-user", false, false, byteArrayOf(7)), false)))
        }
        val path = context.getDatabasePath("native-document-sessions.db")
        val corrupted = ByteArray(4096) { 0x3a.toByte() }
        path.writeBytes(corrupted)
        NativeSessionStorage(context, "corrupt-file-fixture", second, "fixture-user").use { secondStore ->
            assertEquals(FfiStorageResult.LoadFailed(StorageFailure.CORRUPT), secondStore.execute(
                StorageOp.Load("corrupt-file-fixture", second, "fixture-user")))
            assertArrayEquals(corrupted, path.readBytes())
        }
    }

    @Test fun corruptSequenceMetadataIsReportedWithoutDeletingPersistedRows() {
        val context = RuntimeEnvironment.getApplication()
        NativeSessionStorage(context, "corrupt-fixture", first, "fixture-user").use { firstStore ->
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalAppend("corrupt-fixture", first,
                WalRecord(1uL, 1000L, "fixture-user", false, false, byteArrayOf(4)), false)))
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.SnapshotSave("corrupt-fixture",
                byteArrayOf(5), WalCover(first, 0uL))))
        }
        context.openOrCreateDatabase("native-document-sessions.db", 0, null).use { raw ->
            NativeSessionStorage(context, "corrupt-fixture", observer, "fixture-user").use { observerStore ->
                for (bad in listOf("2", "00000000000000000000")) {
                    raw.execSQL("UPDATE updates SET seq=? WHERE doc=?", arrayOf(bad, "corrupt-fixture"))
                    assertEquals(FfiStorageResult.LoadFailed(StorageFailure.CORRUPT), observerStore.execute(
                        StorageOp.Load("corrupt-fixture", observer, "fixture-user")))
                    raw.rawQuery("SELECT seq,bytes FROM updates WHERE doc=?", arrayOf("corrupt-fixture")).use {
                        assertTrue(it.moveToFirst())
                        assertEquals(bad, it.getString(0))
                        assertArrayEquals(byteArrayOf(4), it.getBlob(1))
                    }
                }
                raw.execSQL("UPDATE updates SET seq=? WHERE doc=?", arrayOf("00000000000000000001", "corrupt-fixture"))
                raw.execSQL("UPDATE updates SET owner=? WHERE doc=?", arrayOf("invalid-owner", "corrupt-fixture"))
                assertEquals(FfiStorageResult.LoadFailed(StorageFailure.CORRUPT), observerStore.execute(
                    StorageOp.Load("corrupt-fixture", observer, "fixture-user")))
                raw.execSQL("UPDATE updates SET owner=? WHERE doc=?", arrayOf(first, "corrupt-fixture"))
                raw.execSQL("UPDATE snapshots SET owner=? WHERE doc=?", arrayOf("invalid-owner", "corrupt-fixture"))
                assertEquals(FfiStorageResult.LoadFailed(StorageFailure.CORRUPT), observerStore.execute(
                    StorageOp.Load("corrupt-fixture", observer, "fixture-user")))
                raw.execSQL("UPDATE snapshots SET owner=? WHERE doc=?", arrayOf(first, "corrupt-fixture"))
                raw.execSQL("UPDATE snapshots SET seq=? WHERE doc=?", arrayOf("2", "corrupt-fixture"))
                assertEquals(FfiStorageResult.LoadFailed(StorageFailure.CORRUPT), observerStore.execute(
                    StorageOp.Load("corrupt-fixture", observer, "fixture-user")))
                raw.execSQL("UPDATE snapshots SET seq=? WHERE doc=?", arrayOf("00000000000000000000", "corrupt-fixture"))
                val loaded = observerStore.execute(StorageOp.Load("corrupt-fixture", observer, "fixture-user"))
                    as FfiStorageResult.Loaded
                assertEquals(0uL, loaded.state.snapshot?.covers?.seq)
                assertArrayEquals(byteArrayOf(4), loaded.state.orphans.single().records.single().record.bytes)
            }
        }
    }

    @Test fun probingLiveOwnerKeepsItsLeaseLockedAgainstOtherProcesses() {
        val context = RuntimeEnvironment.getApplication()
        val key = java.security.MessageDigest.getInstance("SHA-256")
            .digest("lease-fixture\u0000$first".toByteArray()).joinToString("") { "%02x".format(it) }
        NativeSessionStorage(context, "lease-fixture", first, "fixture-user").use { firstStore ->
            firstStore.execute(StorageOp.WalAppend("lease-fixture", first,
                WalRecord(1uL, 1000L, "fixture-user", false, false, byteArrayOf(1)), false))
            NativeSessionStorage(context, "lease-fixture", second, "fixture-user").use { secondStore ->
                secondStore.execute(StorageOp.Load("lease-fixture", second, "fixture-user"))
                val probe = ProcessBuilder(java.io.File(System.getProperty("java.home"), "bin/java").path,
                    "-cp", requireNotNull(System.getProperty("native.editor.probe.classpath")),
                    LeaseProbe::class.java.name,
                    java.io.File(context.noBackupFilesDir, "native-editor-leases/$key").path).start()
                assertTrue(probe.waitFor(10, java.util.concurrent.TimeUnit.SECONDS))
                assertEquals(probe.errorStream.bufferedReader().readText(), 0, probe.exitValue())
            }
        }
    }

    @Test fun foreignUserRowsAreNeverAdoptedAndScopeMismatchesDoNotWrite() {
        val context = RuntimeEnvironment.getApplication()
        NativeSessionStorage(context, "isolation-fixture", first, "fixture-user").use { firstStore ->
            assertTrue(firstStore.execute(StorageOp.WalAppend("wrong-document", first,
                WalRecord(1uL, 1000L, "fixture-user", false, false, byteArrayOf(1)), false))
                is FfiStorageResult.WriteFailed)
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalAppend("isolation-fixture", first,
                WalRecord(1uL, 1000L, "fixture-user", true, true, byteArrayOf(2)), false)))
            NativeSessionStorage(context, "isolation-fixture", second, "other-fixture-user").use { secondStore ->
                val loaded = secondStore.execute(StorageOp.Load("isolation-fixture", second, "other-fixture-user"))
                    as FfiStorageResult.Loaded
                assertTrue(loaded.state.assist.isEmpty())
                assertTrue(loaded.state.orphans.isEmpty())
            }
        }
        NativeSessionStorage(context, "isolation-fixture", second, "other-fixture-user").use { secondStore ->
            val loaded = secondStore.execute(StorageOp.Load("isolation-fixture", second, "other-fixture-user"))
                as FfiStorageResult.Loaded
            val rows = loaded.state.orphans.single().records
            assertTrue(secondStore.execute(StorageOp.WalAdopt("isolation-fixture", WalOwner.Session(first),
                second, 1uL, 0uL, rows)) is FfiStorageResult.AdoptFailed)
        }
        NativeSessionStorage(context, "isolation-fixture", third, "fixture-user").use { thirdStore ->
            val loaded = thirdStore.execute(StorageOp.Load("isolation-fixture", third, "fixture-user"))
                as FfiStorageResult.Loaded
            assertEquals(first, (loaded.state.orphans.single().owner as WalOwner.Session).v1)
            assertTrue(loaded.state.orphans.single().records.single().record.foreign)
            assertTrue(loaded.state.orphans.single().records.single().record.quarantined)
            assertArrayEquals(byteArrayOf(2), loaded.state.orphans.single().records.single().record.bytes)
        }
    }

    @Test fun committedRowsSurviveReopenAndRequireMatchingAdoptionBaseline() {
        val context = RuntimeEnvironment.getApplication()
        val record = WalRecord(1uL, 1000L, "fixture-user", false, false, byteArrayOf(1, 2, 3))
        NativeSessionStorage(context, "storage-fixture", first, "fixture-user").use { firstStore ->
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalAppend(
                "storage-fixture", first, record, false)))
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalAppend(
                "storage-fixture", first, record.copy(bytes = byteArrayOf(9)), true)))
            NativeSessionStorage(context, "storage-fixture", second, "fixture-user").use { secondStore ->
                val loaded = secondStore.execute(StorageOp.Load("storage-fixture", second, "fixture-user"))
                    as FfiStorageResult.Loaded
                assertTrue(loaded.state.orphans.isEmpty())
                assertArrayEquals(byteArrayOf(1, 2, 3), loaded.state.assist.single().records.single().record.bytes)
                assertTrue(secondStore.execute(StorageOp.WalAdopt("storage-fixture", WalOwner.Session(first),
                    second, 10uL, 0uL, loaded.state.assist.single().records)) is FfiStorageResult.AdoptFailed)
            }
        }
        NativeSessionStorage(context, "storage-fixture", second, "fixture-user").use { secondStore ->
            val loaded = secondStore.execute(StorageOp.Load("storage-fixture", second, "fixture-user"))
                as FfiStorageResult.Loaded
            assertTrue(loaded.state.assist.isEmpty())
            val rows = loaded.state.orphans.single().records
            assertArrayEquals(byteArrayOf(1, 2, 3), rows.single().record.bytes)
            assertTrue(secondStore.execute(StorageOp.WalAdopt("storage-fixture", WalOwner.Session(first),
                second, 10uL, 0uL, listOf(rows.single().copy(delivered = true)))) is FfiStorageResult.AdoptFailed)
            assertEquals(FfiStorageResult.Adopted(1u), secondStore.execute(StorageOp.WalAdopt(
                "storage-fixture", WalOwner.Session(first), second, 10uL, 0uL, rows)))
            // Retrying the completed adoption neither duplicates nor renumbers existing rows.
            assertEquals(FfiStorageResult.Adopted(0u), secondStore.execute(StorageOp.WalAdopt(
                "storage-fixture", WalOwner.Session(first), second, 11uL, 0uL, rows)))
        }
        NativeSessionStorage(context, "storage-fixture", third, "fixture-user").use { thirdStore ->
            val loaded = thirdStore.execute(StorageOp.Load("storage-fixture", third, "fixture-user"))
                as FfiStorageResult.Loaded
            assertEquals(10uL, loaded.state.orphans.single().records.single().record.seq)
            assertArrayEquals(byteArrayOf(1, 2, 3), loaded.state.orphans.single().records.single().record.bytes)
        }
    }

    @Test fun pruningNeedsBothDurableCoverageAndDeliveryAcrossUnsignedSequenceRange() {
        val context = RuntimeEnvironment.getApplication()
        val seq = ULong.MAX_VALUE
        NativeSessionStorage(context, "prune-fixture", first, "fixture-user").use { firstStore ->
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalAppend("prune-fixture", first,
                WalRecord(seq, 1000L, "fixture-user", false, false, byteArrayOf(7)), false)))
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalMarkDelivered("prune-fixture", first, seq)))
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalPrune("prune-fixture", first, seq)))
        }
        NativeSessionStorage(context, "prune-fixture", observer, "fixture-user").use { observerStore ->
            val loaded = observerStore.execute(StorageOp.Load("prune-fixture", observer, "fixture-user"))
                as FfiStorageResult.Loaded
            assertEquals(seq, loaded.state.orphans.single().records.single().record.seq)
            assertTrue(loaded.state.orphans.single().records.single().delivered)
        }
        NativeSessionStorage(context, "prune-fixture", first, "fixture-user").use { firstStore ->
            NativeSessionStorage(context, "prune-fixture", observer, "fixture-user").use { observerStore ->
                // Delivered live rows are not assist work; after owner closes they must reappear.
                assertTrue((observerStore.execute(StorageOp.Load("prune-fixture", observer, "fixture-user"))
                    as FfiStorageResult.Loaded).state.assist.isEmpty())
            }
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.SnapshotSave("prune-fixture",
                byteArrayOf(9), WalCover(first, seq))))
            assertEquals(FfiStorageResult.Done, firstStore.execute(StorageOp.WalPrune("prune-fixture", first, seq)))
        }
        NativeSessionStorage(context, "prune-fixture", observer, "fixture-user").use { observerStore ->
            val loaded = observerStore.execute(StorageOp.Load("prune-fixture", observer, "fixture-user"))
                as FfiStorageResult.Loaded
            assertTrue(loaded.state.orphans.isEmpty())
            assertArrayEquals(byteArrayOf(9), loaded.state.snapshot?.bytes)
            assertEquals(seq, loaded.state.snapshot?.covers?.seq)
        }
    }
}
