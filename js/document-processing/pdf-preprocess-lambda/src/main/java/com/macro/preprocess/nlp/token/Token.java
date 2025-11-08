package com.macro.preprocess.nlp.token;

public class Token {
    protected String word_form;
    protected int start_offset;
    protected int end_offset;

    public Token(String form) {
        this(form, -1, -1);
    }

    public Token(String form, int startOffset, int endOffset) {
        this.setStartOffset(startOffset);
        this.setEndOffset(endOffset);
        this.setWordForm(form);
    }

    public String getWordForm() {
        return this.word_form;
    }

    public void setWordForm(String form) {
        this.word_form = form;
    }

    public int getStartOffset() {
        return this.start_offset;
    }

    public void setStartOffset(int offset) {
        this.start_offset = offset;
    }

    public int getEndOffset() {
        return this.end_offset;
    }

    public void setEndOffset(int offset) {
        this.end_offset = offset;
    }

    public void resetEndOffset() {
        this.setEndOffset(this.start_offset + this.word_form.length());
    }

    public boolean isWordForm(String form) {
        return this.word_form.equals(form);
    }

    public String toString() {
        return this.word_form;
    }
}
