package com.macro.preprocess.nlp.lexicon;

import com.macro.preprocess.nlp.component.template.feature.Field;

public class GlobalLexicon<T> {
    private T lexicon;
    private Field field;
    private String name;

    public GlobalLexicon() {
    }

    public GlobalLexicon(T lexicon, Field field, String name) {
        this.setLexicon(lexicon);
        this.setField(field);
        this.setName(name);
    }

    public T getLexicon() {
        return this.lexicon;
    }

    public void setLexicon(T lexicon) {
        this.lexicon = lexicon;
    }

    public Field getField() {
        return this.field;
    }

    public void setField(Field field) {
        this.field = field;
    }

    public String getName() {
        return this.name;
    }

    public void setName(String name) {
        this.name = name;
    }
}