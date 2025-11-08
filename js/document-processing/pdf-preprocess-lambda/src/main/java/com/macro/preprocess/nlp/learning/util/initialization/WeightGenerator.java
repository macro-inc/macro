package com.macro.preprocess.nlp.learning.util.initialization;

import java.io.Serializable;

public interface WeightGenerator extends Serializable {
    float next();
}