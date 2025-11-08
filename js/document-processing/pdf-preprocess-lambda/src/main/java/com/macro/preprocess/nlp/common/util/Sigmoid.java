package com.macro.preprocess.nlp.common.util;

import java.io.Serializable;

public class Sigmoid implements Serializable {
    private static final long serialVersionUID = -5529599420715450956L;
    private final float[] table;
    private final float floor;
    private final float ceiling;
    private final float table_multiply;
    private final int table_adjust;

    public Sigmoid() {
        this(3500, -6.0F, 6.0F);
    }

    public Sigmoid(int size, float floor, float ceiling) {
        this.floor = floor;
        this.ceiling = ceiling;
        this.table = new float[size];
        float range = ceiling - floor;
        this.table_adjust = (int)(0.5 - (double)(floor * (float)(size - 1) / range));
        this.table_multiply = (float)(size - 1) / range;

        for(int i = 0; i < size; ++i) {
            this.table[i] = (float)(1.0 / (1.0 + Math.exp(6.0 * ((double)(floor + ceiling) - 2.0 * (double)(floor + range * (float)i / (float)(size - 1))) / (double)range)));
        }

    }

    public final float get(float d) {
        return d <= this.floor ? 0.0F : (d >= this.ceiling ? 1.0F : this.table[(int)(d * this.table_multiply) + this.table_adjust]);
    }
}