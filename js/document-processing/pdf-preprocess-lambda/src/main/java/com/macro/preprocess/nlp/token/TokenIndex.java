package com.macro.preprocess.nlp.token;

public class TokenIndex {
    int val;

    public TokenIndex() {
    }

    public TokenIndex(int val) {
        this.val = val;
    }

    public int getVal() {
        return this.val;
    }

    public void setVal(int val) {
        this.val = val;
    }

    public String toString() {
        return Integer.toString(this.val);
    }

    public boolean equals(Object obj) {
        if (!TokenIndex.class.isInstance(obj)) {
            return false;
        } else {
            TokenIndex input = (TokenIndex)obj;
            return input.getVal() == this.val;
        }
    }

    public int hashCode() {
        int prime = 31;
        int result = 1;
        result = result * prime + this.val;
        return result;
    }
}