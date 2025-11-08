package com.macro.preprocess.nlp.collection.tree;

import it.unimi.dsi.fastutil.chars.Char2ObjectOpenHashMap;

import java.util.Collection;
import java.util.Iterator;

public class CharAffixTree {
    private CharAffixNode n_root;
    private boolean b_prefix;

    public CharAffixTree(boolean prefix) {
        this.init(prefix);
    }

    public CharAffixTree(boolean prefix, Collection<String> col) {
        this.init(prefix);
        this.addAll(col);
    }

    public CharAffixTree(boolean prefix, String[] array) {
        this.init(prefix);
        this.addAll(array);
    }

    private void init(boolean prefix) {
        this.n_root = new CharAffixNode();
        this.b_prefix = prefix;
    }

    public void addAll(Collection<String> col) {
        Iterator var2 = col.iterator();

        while(var2.hasNext()) {
            String s = (String)var2.next();
            this.add(s);
        }

    }

    public void addAll(String[] array) {
        String[] var2 = array;
        int var3 = array.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            String s = var2[var4];
            this.add(s);
        }

    }

    public void add(String s) {
        int len = s.length();
        char[] cs = s.toCharArray();
        int beginIndex;
        byte direction;
        if (this.b_prefix) {
            beginIndex = 0;
            direction = 1;
        } else {
            beginIndex = len - 1;
            direction = -1;
        }

        CharAffixNode curr = this.n_root;

        for(int i = beginIndex; 0 <= i && i < len; i += direction) {
            CharAffixNode next = (CharAffixNode)curr.get(cs[i]);
            if (next == null) {
                next = new CharAffixNode();
                curr.put(cs[i], next);
            }

            curr = next;
        }

        curr.setEndState(true);
    }

    public int getAffixIndex(String s, boolean minimum) {
        int index = -1;
        int len = s.length();
        char[] cs = s.toCharArray();
        CharAffixNode curr = this.n_root;
        int beginIndex;
        byte direction;
        if (this.b_prefix) {
            beginIndex = 0;
            direction = 1;
        } else {
            beginIndex = len - 1;
            direction = -1;
        }

        for(int i = beginIndex; 0 <= i && i < len; i += direction) {
            curr = (CharAffixNode)curr.get(cs[i]);
            if (curr == null) {
                break;
            }

            if (curr.isEndState()) {
                index = i;
                if (minimum) {
                    break;
                }
            }
        }

        return index;
    }

    private class CharAffixNode extends Char2ObjectOpenHashMap<CharAffixNode> {
        private static final long serialVersionUID = 1566684742873455351L;
        private boolean b_endState = false;

        public CharAffixNode() {
        }

        public boolean isEndState() {
            return this.b_endState;
        }

        public void setEndState(boolean endState) {
            this.b_endState = endState;
        }
    }
}