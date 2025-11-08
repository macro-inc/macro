package com.macro.preprocess.nlp.dictionary;

import com.macro.preprocess.utils.CharUtils;
import com.macro.preprocess.utils.DSUtils;
import com.macro.preprocess.utils.IOUtils;

import java.io.InputStream;
import java.util.Iterator;
import java.util.Set;

public class Unit extends Dictionary {
    private Set<String> s_unit;

    public Unit() {
        this.init(IOUtils.getInputStreamsFromResource(ROOT + "units.txt"));
    }

    public Unit(InputStream in) {
        this.init(in);
    }

    public void init(InputStream in) {
        this.s_unit = DSUtils.createStringHashSet(in, true, true);
    }

    public boolean isUnit(String lower) {
        return this.s_unit.contains(lower);
    }

    public String[] tokenize(String original, String lower, char[] lcs) {
        int len = original.length();
        Iterator var5 = this.s_unit.iterator();

        while(var5.hasNext()) {
            String unit = (String)var5.next();
            if (lower.endsWith(unit)) {
                int i = len - unit.length();
                if (0 < i && CharUtils.isDigit(lcs[i - 1])) {
                    return new String[]{original.substring(0, i), original.substring(i)};
                }
            }
        }

        return null;
    }
}