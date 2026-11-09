package com.macro.editor

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteFullException
import android.database.sqlite.SQLiteOpenHelper
import com.macro.documentsession.*
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileLock
import java.security.MessageDigest

/** Private SQLite WAL adapter. Execute on the host's storage worker, never inside FFI. */
class NativeSessionStorage(
    context: Context,
    private val doc: SyncDocId,
    owner: SessionId,
    private val user: UserKey,
) : AutoCloseable {
    private val owner = sessionId(owner)
    private val directory = File(context.noBackupFilesDir, "native-editor-leases").apply { mkdirs() }
    private val lease = requireNotNull(acquire(owner)) { "Session owner already has a live lease" }
    private val helper = object : SQLiteOpenHelper(context, "native-document-sessions.db", null, 1,
        DatabaseErrorHandler { throw SQLiteDatabaseCorruptException("Native session database is corrupt") }) {
        override fun onConfigure(db: SQLiteDatabase) {
            db.execSQL("PRAGMA synchronous=FULL")
        }
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE snapshots (doc TEXT PRIMARY KEY, bytes BLOB NOT NULL, owner TEXT, seq TEXT)")
            db.execSQL("CREATE TABLE updates (doc TEXT NOT NULL, owner TEXT NOT NULL, seq TEXT NOT NULL, created_at INTEGER NOT NULL, user TEXT NOT NULL, foreign_row INTEGER NOT NULL, quarantined INTEGER NOT NULL, delivered INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(doc, owner, seq))")
        }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            error("Unsupported native session storage schema")
        }
    }
    private var closed = false

    /** A successful result is returned only after SQLite confirms the entire transaction. */
    @Synchronized fun execute(op: StorageOp): FfiStorageResult {
        if (closed) return failure(op, StorageFailure.UNAVAILABLE)
        var sourceLease: Lease? = null
        return try {
            validate(op)
            val source = when (op) {
                is StorageOp.WalAdopt -> op.from
                is StorageOp.WalDropExpired -> op.from
                else -> null
            }
            if (source is WalOwner.Session) {
                sourceLease = acquire(source.v1) ?: return failure(op, StorageFailure.OTHER)
            }
            val db = helper.writableDatabase
            db.beginTransaction()
            try {
                val result = apply(db, op)
                db.setTransactionSuccessful()
                result
            } finally {
                db.endTransaction()
            }
        } catch (error: SQLiteDatabaseCorruptException) {
            failure(op, StorageFailure.CORRUPT)
        } catch (error: SQLiteFullException) {
            failure(op, StorageFailure.QUOTA_EXCEEDED)
        } catch (error: IllegalArgumentException) {
            failure(op, StorageFailure.CORRUPT)
        } catch (error: Exception) {
            // A write error may include a lost commit acknowledgement. Never infer rollback.
            failure(op, if (op is StorageOp.Load || op is StorageOp.LoadOrphans)
                StorageFailure.UNAVAILABLE else StorageFailure.UNCERTAIN)
        } finally {
            sourceLease?.close()
        }
    }

    private fun validate(op: StorageOp) {
        val scope = when (op) {
            is StorageOp.Load -> { require(op.user == user); op.doc to op.owner }
            is StorageOp.LoadOrphans -> { require(op.user == user); op.doc to op.owner }
            is StorageOp.WalAppend -> { require(op.record.user == user); op.doc to op.owner }
            is StorageOp.WalMarkDelivered -> op.doc to op.owner
            is StorageOp.WalPrune -> op.doc to op.owner
            is StorageOp.WalQuarantine -> op.doc to op.owner
            is StorageOp.WalAdopt -> op.doc to op.to
            is StorageOp.WalDropExpired -> op.doc to owner
            is StorageOp.SnapshotSave -> op.doc to owner
            is StorageOp.SnapshotDelete -> op.doc to owner
        }
        require(scope.first == doc && scope.second == owner) { "Storage scope mismatch" }
    }

    private data class Row(val owner: String, val stored: StoredWalRecord)

    private fun rows(db: SQLiteDatabase): List<Row> = db.query("updates", null, "doc=?",
        arrayOf(doc), null, null, "owner,seq").use { cursor ->
        buildList {
            while (cursor.moveToNext()) {
                add(Row(sessionId(cursor.string("owner")), StoredWalRecord(WalRecord(
                    cursor.sequence("seq", false), cursor.long("created_at"), cursor.string("user"),
                    cursor.boolean("foreign_row"), cursor.boolean("quarantined"), cursor.bytes("bytes"),
                ), cursor.boolean("delivered"))))
            }
        }
    }

    private fun snapshot(db: SQLiteDatabase): StoredSnapshot? = db.query("snapshots", null,
        "doc=?", arrayOf(doc), null, null, null).use { cursor ->
        if (!cursor.moveToFirst()) return@use null
        val bytes = cursor.bytes("bytes")
        val ownerIndex = cursor.getColumnIndexOrThrow("owner")
        val covers = if (cursor.isNull(ownerIndex)) {
            require(cursor.isNull(cursor.getColumnIndexOrThrow("seq")))
            null
        } else WalCover(sessionId(cursor.string("owner")), cursor.sequence("seq", true))
        if (bytes.isEmpty()) return@use null
        StoredSnapshot(bytes, covers)
    }

    private fun apply(db: SQLiteDatabase, op: StorageOp): FfiStorageResult {
        when (op) {
            is StorageOp.Load, is StorageOp.LoadOrphans -> {
                val orphans = linkedMapOf<WalOwner, MutableList<StoredWalRecord>>()
                val assist = linkedMapOf<WalOwner, MutableList<StoredWalRecord>>()
                for (row in rows(db)) {
                    if (row.owner == owner) continue
                    val check = acquire(row.owner)
                    val live = check == null
                    check?.close()
                    if (live && row.stored.record.user != user) continue
                    if (live && row.stored.delivered) continue
                    val target = if (live) assist else orphans
                    target.getOrPut(WalOwner.Session(row.owner)) { mutableListOf() }.add(row.stored)
                }
                return FfiStorageResult.Loaded(LocalState(
                    if (op is StorageOp.Load) snapshot(db) else null,
                    orphans.map { OrphanWal(it.key, it.value) }, assist.map { OrphanWal(it.key, it.value) },
                ))
            }
            is StorageOp.WalAppend -> {
                require(op.record.seq > 0uL)
                db.insertWithOnConflict("updates", null, values(owner, op.record, false),
                    SQLiteDatabase.CONFLICT_IGNORE)
            }
            is StorageOp.WalMarkDelivered -> db.update("updates", ContentValues().apply {
                put("delivered", 1)
            }, "doc=? AND owner=? AND seq<=?", arrayOf(doc, owner, sequence(op.through)))
            is StorageOp.WalPrune -> {
                val cover = snapshot(db)?.covers
                if (cover?.owner == owner) db.delete("updates",
                    "doc=? AND owner=? AND seq<=? AND seq<=? AND delivered=1",
                    arrayOf(doc, owner, sequence(op.through), sequence(cover.seq)))
            }
            is StorageOp.WalQuarantine -> db.update("updates", ContentValues().apply {
                put("quarantined", 1)
            }, "doc=? AND owner=? AND seq=?", arrayOf(doc, owner, sequence(op.seq)))
            is StorageOp.WalDropExpired -> db.delete("updates",
                "doc=? AND owner=? AND created_at<? AND delivered=0",
                arrayOf(doc, ownerString(op.from), op.before.toString()))
            is StorageOp.WalAdopt -> return adopt(db, op)
            is StorageOp.SnapshotSave -> db.insertWithOnConflict("snapshots", null, ContentValues().apply {
                put("doc", doc)
                put("bytes", op.bytes)
                op.covers?.let { put("owner", it.owner); put("seq", sequence(it.seq)) }
            }, SQLiteDatabase.CONFLICT_REPLACE)
            is StorageOp.SnapshotDelete -> db.delete("snapshots", "doc=?", arrayOf(doc))
        }
        return FfiStorageResult.Done
    }

    private fun adopt(db: SQLiteDatabase, op: StorageOp.WalAdopt): FfiStorageResult {
        val from = ownerString(op.from)
        val cover = snapshot(db)?.covers
        val covered = if (cover?.owner == from) cover.seq else 0uL
        if (covered != op.covers) return FfiStorageResult.AdoptFailed(StorageFailure.OTHER)
        val all = rows(db)
        val source = all.filter { it.owner == from }
        require(source.all { it.stored.record.user == user }) { "Foreign user adoption" }
        val selected = source.filter { !it.stored.delivered || it.stored.record.seq > covered }
        if (selected.isNotEmpty() && (selected.size != op.expected.size ||
            selected.indices.any { !same(selected[it].stored, op.expected[it]) })) {
            return FfiStorageResult.AdoptFailed(StorageFailure.OTHER)
        }
        val count = selected.size.toULong()
        if (count > 0uL && (op.firstSeq == 0uL || op.firstSeq > ULong.MAX_VALUE - (count - 1uL))) {
            return FfiStorageResult.AdoptFailed(StorageFailure.OTHER)
        }
        if (selected.indices.any { index -> all.any {
            it.owner == owner && it.stored.record.seq == op.firstSeq + index.toULong()
        } }) return FfiStorageResult.AdoptFailed(StorageFailure.OTHER)
        db.delete("updates", "doc=? AND owner=?", arrayOf(doc, from))
        selected.forEachIndexed { index, row ->
            db.insertOrThrow("updates", null, values(owner,
                row.stored.record.copy(seq = op.firstSeq + index.toULong()), row.stored.delivered))
        }
        return FfiStorageResult.Adopted(selected.size.toUInt())
    }

    private fun same(left: StoredWalRecord, right: StoredWalRecord): Boolean {
        val a = left.record
        val b = right.record
        return left.delivered == right.delivered && a.seq == b.seq && a.createdAt == b.createdAt &&
            a.user == b.user && a.foreign == b.foreign && a.quarantined == b.quarantined &&
            a.bytes.contentEquals(b.bytes)
    }

    private fun values(rowOwner: String, record: WalRecord, delivered: Boolean) = ContentValues().apply {
        put("doc", doc); put("owner", rowOwner); put("seq", sequence(record.seq))
        put("created_at", record.createdAt); put("user", record.user)
        put("foreign_row", if (record.foreign) 1 else 0)
        put("quarantined", if (record.quarantined) 1 else 0)
        put("delivered", if (delivered) 1 else 0); put("bytes", record.bytes)
    }

    private fun failure(op: StorageOp, error: StorageFailure): FfiStorageResult = when (op) {
        is StorageOp.Load, is StorageOp.LoadOrphans -> FfiStorageResult.LoadFailed(error)
        is StorageOp.WalAdopt -> FfiStorageResult.AdoptFailed(error)
        else -> FfiStorageResult.WriteFailed(error)
    }

    private fun sequence(value: ULong) = value.toString().padStart(20, '0')
    private fun sessionId(value: String): String {
        require(java.util.UUID.fromString(value).toString() == value) { "Invalid stored session identity" }
        return value
    }
    private fun ownerString(value: WalOwner): String = when (value) {
        is WalOwner.Session -> value.v1
        WalOwner.Legacy -> ""
    }
    private fun Cursor.string(name: String): String {
        val index = getColumnIndexOrThrow(name)
        require(getType(index) == Cursor.FIELD_TYPE_STRING)
        return getString(index)
    }
    private fun Cursor.long(name: String): Long {
        val index = getColumnIndexOrThrow(name)
        require(getType(index) == Cursor.FIELD_TYPE_INTEGER)
        return getLong(index)
    }
    private fun Cursor.boolean(name: String): Boolean {
        val value = long(name)
        require(value == 0L || value == 1L)
        return value == 1L
    }
    private fun Cursor.bytes(name: String): ByteArray {
        val index = getColumnIndexOrThrow(name)
        require(getType(index) == Cursor.FIELD_TYPE_BLOB)
        return getBlob(index)
    }
    private fun Cursor.sequence(name: String, allowZero: Boolean): ULong {
        val encoded = string(name)
        val value = encoded.toULong()
        require(encoded == sequence(value) && (allowZero || value > 0uL))
        return value
    }

    private class Lease(private val path: String, private val file: RandomAccessFile,
        private val lock: FileLock) : AutoCloseable {
        private var closed = false
        override fun close() = synchronized(leaseMonitor) {
            if (!closed) {
                closed = true
                try { lock.release() } finally {
                    try { file.close() } finally { heldLeasePaths.remove(path) }
                }
            }
        }
    }
    private fun acquire(session: String): Lease? {
        val key = MessageDigest.getInstance("SHA-256").digest((doc + "\u0000" + session).toByteArray())
            .joinToString("") { "%02x".format(it) }
        val path = File(directory, key).canonicalPath
        return synchronized(leaseMonitor) {
            // Closing another descriptor for this inode can release the process's OS lock.
            if (path in heldLeasePaths) return@synchronized null
            val file = RandomAccessFile(path, "rw")
            try {
                val lock = file.channel.tryLock()
                if (lock == null) { file.close(); null } else {
                    heldLeasePaths.add(path)
                    Lease(path, file, lock)
                }
            } catch (error: Exception) { file.close(); throw error }
        }
    }

    companion object {
        private val leaseMonitor = Any()
        private val heldLeasePaths = mutableSetOf<String>()
    }

    @Synchronized override fun close() {
        if (closed) return
        closed = true
        try { helper.close() } finally { lease.close() }
    }
}
