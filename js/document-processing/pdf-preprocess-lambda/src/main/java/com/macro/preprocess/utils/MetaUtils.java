package com.macro.preprocess.utils;

import com.macro.preprocess.nlp.collection.tree.CharAffixTree;

import java.util.regex.Pattern;

public class MetaUtils {
    public static final String[] PROTOCOLS = new String[]{"http://", "https://", "https://", "ftp://", "sftp://"};
    public static final Pattern EMOTICON = Pattern.compile("[\\!\\|;:#%][-]*[\\(\\)\\[\\]\\{\\}\\|<>]+");
    public static final CharAffixTree FILE_EXTENSION = new CharAffixTree(false, new String[]{"3gp", "7z", "ace", "ai", "aif", "aiff", "amr", "asf", "asp", "aspx", "asx", "avi", "bat", "bin", "bmp", "bup", "cab", "cbr", "cda", "cdl", "cdr", "chm", "dat", "divx", "dll", "dmg", "doc", "dss", "dvf", "dwg", "eml", "eps", "exe", "fla", "flv", "gif", "gz", "hqx", "htm", "html", "shtml", "ifo", "indd", "iso", "jar", "jsp", "jpg", "jpeg", "lnk", "log", "m4a", "m4b", "m4p", "m4v", "mcd", "mdb", "mid", "mov", "mp2", "mp3", "mp4", "mpg", "mpeg", "msi", "mswmm", "ogg", "pdf", "php", "png", "pps", "ppt", "ps", "psd", "pst", "ptb", "pub", "qbb", "qbw", "qxd", "ram", "rar", "rm", "rmvb", "rtf", "sea", "ses", "sit", "sitx", "sql", "ss", "swf", "tgz", "tif", "torrent", "ttf", "txt", "vcd", "vob", "wav", "wma", "wmv", "wpd", "wps", "xls", "xml", "xtm", "zip"});
    public static final Pattern HYPERLINK = Pattern.compile("(\\p{Alpha}{3,9}://)?([\\p{Alnum}_]+(:\\S*)?@)?((\\d{3}(\\.\\d{1,3}){3})|(\\w+(-\\w+)*(\\.\\w+(-\\w+)*)*\\.\\p{Alpha}{2,}))(:\\d{2,5})?(/\\S*)?");
    public static final Pattern FAST_HYPERLINK = Pattern.compile("((www\\.)?[\\w]+\\.(com|net|org))");

    private MetaUtils() {
    }

    public static boolean startsWithNetworkProtocol(String s) {
        s = StringUtils.toLowerCase(s);
        String[] var1 = PROTOCOLS;
        int var2 = var1.length;

        for(int var3 = 0; var3 < var2; ++var3) {
            String protocol = var1[var3];
            if (s.startsWith(protocol)) {
                return true;
            }
        }

        return false;
    }

    public static boolean containsHyperlink(String s) {
        return startsWithNetworkProtocol(s) || HYPERLINK.matcher(s).find();
    }

    public static boolean endsWithFileExtension(String s) {
        int idx = FILE_EXTENSION.getAffixIndex(s, false);
        return idx > 0 ? s.charAt(idx - 1) == '.' : false;
    }
}
