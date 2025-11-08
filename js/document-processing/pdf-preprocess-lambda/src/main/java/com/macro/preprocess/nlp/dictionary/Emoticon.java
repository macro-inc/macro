package com.macro.preprocess.nlp.dictionary;

import com.macro.preprocess.nlp.collection.tree.CharAffixTree;
import com.macro.preprocess.utils.DSUtils;
import com.macro.preprocess.utils.IOUtils;
import com.macro.preprocess.utils.MetaUtils;
import com.macro.preprocess.utils.StringUtils;

import java.io.InputStream;
import java.util.Set;
import java.util.regex.Matcher;

public class Emoticon {
    private Set<String> s_emoticon;
    private CharAffixTree t_prefix;
    private CharAffixTree t_suffix;

    public Emoticon() {
        this.init(IOUtils.getInputStreamsFromResource(Dictionary.ROOT + "emoticons.txt"));
    }

    public Emoticon(InputStream in) {
        this.init(in);
    }

    public void init(InputStream in) {
        this.s_emoticon = DSUtils.createStringHashSet(in, true, false);
        this.t_prefix = new CharAffixTree(true);
        this.t_prefix.addAll(this.s_emoticon);
        this.t_suffix = new CharAffixTree(false);
        this.t_suffix.addAll(this.s_emoticon);
    }

    public int[] getEmoticonRange(String s) {
        s = StringUtils.toLowerCase(s);
        if (this.s_emoticon.contains(s)) {
            return new int[]{0, s.length()};
        } else {
            Matcher m = MetaUtils.EMOTICON.matcher(s);
            if (m.find()) {
                return new int[]{m.start(), m.end()};
            } else {
                int idx;
                if ((idx = this.t_prefix.getAffixIndex(s, false)) >= 0) {
                    return new int[]{0, idx + 1};
                } else {
                    return (idx = this.t_suffix.getAffixIndex(s, false)) >= 0 ? new int[]{idx, s.length()} : null;
                }
            }
        }
    }
}