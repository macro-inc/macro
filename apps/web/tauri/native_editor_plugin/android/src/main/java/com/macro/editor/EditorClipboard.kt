package com.macro.editor

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.macro.documentsession.*

/** Reads system text MIME entries and writes Android's HTML/plain clipboard pair. */
internal class EditorClipboard(context: Context) {
    private val clipboard = context.getSystemService(ClipboardManager::class.java)

    fun read(): FfiClipboardPayload? {
        val clip = clipboard.primaryClip ?: return null
        if (clip.itemCount == 0) return null
        val item = clip.getItemAt(0)
        val entries = mutableListOf<FfiClipboardEntry>()
        item.htmlText?.let { entries += FfiClipboardEntry("text/html", it) }
        if (clip.description.hasMimeType("text/markdown")) {
            item.text?.let { entries += FfiClipboardEntry("text/markdown", it.toString()) }
        }
        item.text?.let { entries += FfiClipboardEntry("text/plain", it.toString()) }
        val files = (0 until clip.itemCount).any { clip.getItemAt(it).uri != null }
        return FfiClipboardPayload(entries, files, null)
    }

    fun write(entries: List<FfiClipboardEntry>): Boolean {
        val plain = entries.firstOrNull { it.mime == "text/plain" }?.text ?: return false
        val html = entries.firstOrNull { it.mime == "text/html" }?.text
        val data = if (html == null) ClipData.newPlainText("", plain)
            else ClipData.newHtmlText("", plain, html)
        clipboard.setPrimaryClip(data)
        return true
    }
}
