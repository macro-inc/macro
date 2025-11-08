package com.macro.preprocess.nlp.reader;

import com.macro.preprocess.nlp.constants.StringConst;
import com.macro.preprocess.utils.IOUtils;
import com.macro.preprocess.utils.Splitter;
import com.macro.preprocess.nlp.node.AbstractNLPNode;
import com.macro.preprocess.nlp.node.FeatMap;
import it.unimi.dsi.fastutil.objects.Object2IntMap;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.List;

public abstract class TSVReader<N extends AbstractNLPNode<N>> {
    public static String BLANK;
    protected BufferedReader reader;
    public int form = -1;
    public int lemma = -1;
    public int pos = -1;
    public int nament = -1;
    public int feats = -1;
    public int dhead = -1;
    public int deprel = -1;
    public int sheads = -1;

    public TSVReader() {
    }

    public TSVReader(int form, int lemma, int pos, int feats, int dhead, int deprel, int sheads, int nament) {
        this.form = form;
        this.lemma = lemma;
        this.pos = pos;
        this.feats = feats;
        this.dhead = dhead;
        this.deprel = deprel;
        this.sheads = sheads;
        this.nament = nament;
    }

    public TSVReader(Object2IntMap<String> map) {
        this.form = (Integer)map.getOrDefault("form", -1);
        this.lemma = (Integer)map.getOrDefault("lemma", -1);
        this.pos = (Integer)map.getOrDefault("pos", -1);
        this.feats = (Integer)map.getOrDefault("feats", -1);
        this.dhead = (Integer)map.getOrDefault("dhead", -1);
        this.deprel = (Integer)map.getOrDefault("deprel", -1);
        this.sheads = (Integer)map.getOrDefault("sheads", -1);
        this.nament = (Integer)map.getOrDefault("nament", -1);
    }

    public void open(InputStream in) {
        this.reader = IOUtils.createBufferedReader(in);
    }

    public void close() {
        try {
            if (this.reader != null) {
                this.reader.close();
            }
        } catch (IOException var2) {
            var2.printStackTrace();
        }

    }

    public List<N[]> readDocument() throws Exception {
        List<N[]> document = new ArrayList();

        AbstractNLPNode[] nodes;
        while((nodes = this.next()) != null) {
            document.add((N[]) nodes);
        }

        return document;
    }

    public N[] next() throws IOException {
        List<String[]> list = new ArrayList();

        String line;
        while((line = this.reader.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty()) {
                if (list.isEmpty()) {
                    continue;
                }
                break;
            } else {
                list.add(Splitter.splitTabs(line));
            }
        }

        return list.isEmpty() ? null : this.toNodeList(list);
    }

    public N[] toNodeList(List<String[]> list) {
        int size = list.size();
        N node = this.create();
        N[] nodes = (N[])((N[]) Array.newInstance(node.getClass(), size + 1));
        nodes[0] = node.toRoot();

        int i;
        for(i = 1; i <= size; ++i) {
            nodes[i] = this.create(i, (String[])list.get(i - 1));
        }

        if (this.dhead >= 0) {
            for(i = 1; i <= size; ++i) {
                this.initDependencyHead(i, (String[])list.get(i - 1), nodes);
            }

            if (this.sheads >= 0) {
                for(i = 1; i <= size; ++i) {
                    this.initSemanticHeads(i, ((String[])list.get(i - 1))[this.sheads], nodes);
                }
            }
        }

        return nodes;
    }

    protected N create(int id, String[] values) {
        String f = this.form >= 0 ? values[this.form] : null;
        String l = this.lemma >= 0 ? values[this.lemma] : null;
        String p = this.pos >= 0 ? values[this.pos] : null;
        String n = this.nament >= 0 ? values[this.nament] : null;
        FeatMap t = this.feats >= 0 ? new FeatMap(values[this.feats]) : new FeatMap();
        N node = this.create();
        node.set(id, f, l, p, n, t, (N) null, (String)null);
        return node;
    }

    protected abstract N create();

    protected String getValue(String[] values, int index, boolean tag) {
        if (index >= 0 && values.length > index) {
            String s = values[index];
            return tag && BLANK.equals(s) ? null : s;
        } else {
            return null;
        }
    }

    protected void initDependencyHead(int id, String[] values, N[] nodes) {
        if (!BLANK.equals(values[this.dhead])) {
            int headID = Integer.parseInt(values[this.dhead]);
            nodes[id].setDependencyHead(nodes[headID], values[this.deprel]);
        }
    }

    protected void initSemanticHeads(int id, String value, N[] nodes) {
        if (!BLANK.equals(value)) {
            N node = nodes[id];
            String[] var7 = Splitter.splitSemiColons(value);
            int var8 = var7.length;

            for(int var9 = 0; var9 < var8; ++var9) {
                String arg = var7[var9];
                String[] t = Splitter.splitColons(arg);
                int headID = Integer.parseInt(t[0]);
                node.addSemanticHead(nodes[headID], t[1]);
            }

        }
    }

    static {
        BLANK = StringConst.UNDERSCORE;
    }
}