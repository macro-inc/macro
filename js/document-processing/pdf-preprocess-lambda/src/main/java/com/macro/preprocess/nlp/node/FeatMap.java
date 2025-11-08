package com.macro.preprocess.nlp.node;

import com.macro.preprocess.utils.Splitter;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

public class FeatMap extends HashMap<String, String> {
    private static final long serialVersionUID = 4093725541292286982L;
    public static final String DELIM_VALUES = ",";
    public static final String DELIM_FEATS = "|";
    public static final String DELIM_KEY_VALUE = "=";

    public FeatMap() {
    }

    public FeatMap(String feats) {
        this.add(feats);
    }

    public void add(String feats) {
        if (feats != null) {
            String[] var5 = Splitter.splitPipes(feats);
            int var6 = var5.length;

            for(int var7 = 0; var7 < var6; ++var7) {
                String feat = var5[var7];
                int idx = feat.indexOf("=");
                if (idx > 0) {
                    String key = feat.substring(0, idx);
                    String value = feat.substring(idx + 1);
                    this.put(key, value);
                }
            }

        }
    }

    public String toString() {

        if (this.isEmpty()) {
            return Character.toString('_');
        } else {
            StringBuilder build = new StringBuilder();
            Iterator var2 = this.entrySet().iterator();

            while(var2.hasNext()) {
                Map.Entry<String, String> entry = (Map.Entry)var2.next();
                build.append("|");
                build.append((String)entry.getKey());
                build.append("=");
                build.append((String)entry.getValue());
            }

            return build.toString().substring("|".length());
        }
    }
}

