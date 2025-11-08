package com.macro.preprocess.nlp.dictionary;

import com.macro.preprocess.utils.Splitter;
import com.macro.preprocess.utils.IOUtils;
import com.macro.preprocess.utils.Language;
import com.macro.preprocess.utils.StringUtils;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class Compound extends Dictionary {
    private Map<String, int[]> m_compound;

    public Compound(Language language) {
        switch (language) {
            case ENGLISH:
                this.init(IOUtils.getInputStreamsFromResource(ROOT + "english-compounds.txt"));
                return;
            default:
                throw new IllegalArgumentException(language.toString());
        }
    }

    public Compound(InputStream in) {
        this.init(in);
    }

    public void init(InputStream in) {
        BufferedReader reader = IOUtils.createBufferedReader(in);
        this.m_compound = new HashMap();

        String line;
        try {
            while((line = reader.readLine()) != null) {
                String[] tokens = Splitter.splitSpace(line.trim());
                StringBuilder build = new StringBuilder();
                int size = tokens.length - 1;
                int[] tmp = new int[size];

                for(int i = 0; i < size; ++i) {
                    String token = tokens[i];
                    tmp[i] = build.length() + token.length();
                    build.append(token);
                }

                build.append(tokens[size]);
                this.m_compound.put(StringUtils.toLowerCase(build.toString()), tmp);
            }
        } catch (IOException var11) {
            var11.printStackTrace();
        }

    }

    public String[] tokenize(String original, String lower, char[] lcs) {
        int[] indices = (int[])this.m_compound.get(lower);
        return indices != null ? Splitter.split(original, indices) : null;
    }
}