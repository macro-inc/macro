package com.macro.mobile

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream

class MobileFilesTest {
    @Test fun providerNamesCannotEscapeStaging() {
        assertEquals("photo.png", MobileFiles.safeName("../../photo.png"))
        assertEquals("file.pdf", MobileFiles.safeName("folder\\file.pdf"))
        assertEquals("attachment", MobileFiles.safeName(".."))
        assertEquals("a_b.txt", MobileFiles.safeName("a\nb.txt"))
        assertEquals(180, MobileFiles.safeName("a".repeat(1000)).length)
    }

    @Test fun copiesExactBytesIncludingEmptyFiles() {
        val file = File.createTempFile("macro-share-test", ".bin")
        try {
            val bytes = ByteArray(150_000) { (it % 251).toByte() }
            MobileFiles.copyBounded(ByteArrayInputStream(bytes), file)
            assertArrayEquals(bytes, file.readBytes())
            MobileFiles.copyBounded(ByteArrayInputStream(byteArrayOf()), file)
            assertEquals(0, file.length())
        } finally { file.delete() }
    }

    @Test fun providerFailureRemovesPartialFile() {
        val file = File.createTempFile("macro-share-test", ".bin")
        val failing = object : InputStream() {
            override fun read(): Int = throw java.io.IOException("Provider disconnected")
        }
        assertThrows(java.io.IOException::class.java) { MobileFiles.copyBounded(failing, file) }
        assertFalse(file.exists())
    }
}
