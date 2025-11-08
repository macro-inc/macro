package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.constants.StringConst;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class FileUtils {
    private FileUtils() {
    }

    public static long getNonFreeMemory() {
        return Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
    }

    public static List<String> getFileList(String path, String extension) {
        return getFileList(path, extension, false);
    }

    public static List<String> getFileList(String path, String extension, boolean recursive) {
        List<String> list = new ArrayList();
        File file = new File(path);
        if (file.isFile()) {
            list.add(path);
        } else if (recursive) {
            getFileListRec(path, extension, list);
        } else {
            String[] var5 = file.list(new FileExtensionFilter(extension));
            int var6 = var5.length;

            for(int var7 = 0; var7 < var6; ++var7) {
                String name = var5[var7];
                name = path + StringConst.FW_SLASH + name;
                if ((new File(name)).isFile()) {
                    list.add(name);
                }
            }
        }

        return list;
    }

    private static void getFileListRec(String path, String extension, List<String> list) {
        String[] var3 = (new File(path)).list();
        int var4 = var3.length;

        for(int var5 = 0; var5 < var4; ++var5) {
            String name = var3[var5];
            name = path + StringConst.FW_SLASH + name;
            if ((new File(name)).isDirectory()) {
                getFileListRec(name, extension, list);
            } else if (name.endsWith(extension)) {
                list.add(name);
            }
        }

    }

    public static String getPath(String filename) {
        int idx = filename.lastIndexOf(47);
        return filename.substring(0, idx);
    }

    public static String getBaseName(String filename) {
        int idx = filename.lastIndexOf(47);
        return filename.substring(idx + 1);
    }

    public static String replaceExtension(String filename, String newExt) {
        int idx = filename.lastIndexOf(StringConst.PERIOD);
        return idx >= 0 ? filename.substring(0, idx + 1) + newExt : null;
    }

    public static String replaceExtension(String filename, String oldExt, String newExt) {
        return filename.endsWith(oldExt) ? filename.substring(0, filename.length() - oldExt.length()) + newExt : null;
    }
}
