package com.macro.preprocess.nlp.common.random;

import java.util.Random;

public class XORShiftRandom extends Random {
    private static final long serialVersionUID = -6971555410750547741L;
    private long seed;

    public XORShiftRandom(long seed) {
        this.seed = seed;
    }

    protected int next(int nbits) {
        long x = this.seed;
        x ^= x << 21;
        x ^= x >>> 35;
        x ^= x << 4;
        this.seed = x;
        x &= (1L << nbits) - 1L;
        return (int)x;
    }
}