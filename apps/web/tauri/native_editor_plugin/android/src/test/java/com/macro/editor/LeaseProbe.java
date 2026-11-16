package com.macro.editor;

import java.io.RandomAccessFile;
import java.nio.channels.FileLock;

/** Separate process so Java's local overlapping-lock table cannot hide lost OS locks. */
public final class LeaseProbe {
    public static void main(String[] args) throws Exception {
        try (RandomAccessFile file = new RandomAccessFile(args[0], "rw")) {
            FileLock lock = file.getChannel().tryLock();
            if (lock == null) return;
            lock.release();
            System.exit(1);
        }
    }
}
