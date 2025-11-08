package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.constants.StringConst;

import java.io.File;
import java.io.FilenameFilter;

public class FileExtensionFilter implements FilenameFilter {
    private String s_extension;

    public FileExtensionFilter(String extension) {
        this.s_extension = StringUtils.toLowerCase(extension);
    }

    public boolean accept(File dir, String name) {
        return this.s_extension.equals(StringConst.ASTERISK) || StringUtils.toLowerCase(name).endsWith(this.s_extension);
    }
}
