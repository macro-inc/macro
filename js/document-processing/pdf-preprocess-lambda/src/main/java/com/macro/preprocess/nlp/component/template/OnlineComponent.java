package com.macro.preprocess.nlp.component.template;

import com.macro.preprocess.nlp.NLPComponent;
import com.macro.preprocess.nlp.component.template.config.NLPConfig;
import com.macro.preprocess.nlp.component.template.feature.FeatureTemplate;
import com.macro.preprocess.nlp.node.AbstractNLPNode;
import com.macro.preprocess.nlp.component.template.state.NLPState;
import com.macro.preprocess.nlp.component.template.eval.Eval;
import com.macro.preprocess.nlp.component.template.train.HyperParameter;
import com.macro.preprocess.nlp.component.template.util.NLPFlag;
import com.macro.preprocess.nlp.learning.optimization.OnlineOptimizer;
import com.macro.preprocess.nlp.learning.FeatureVector;
import com.macro.preprocess.nlp.learning.Instance;
import com.macro.preprocess.nlp.learning.MLUtils;

import java.io.InputStream;
import java.io.Serializable;
import java.util.Iterator;
import java.util.List;

public abstract class OnlineComponent<N extends AbstractNLPNode<N>, S extends NLPState<N>> implements NLPComponent<N>, Serializable {
    private static final long serialVersionUID = 59819173578703335L;
    protected FeatureTemplate<N, S> feature_template;
    protected boolean document_based;
    protected OnlineOptimizer optimizer;
    protected transient HyperParameter hyper_parameter;
    protected transient NLPConfig<N> config;
    protected transient NLPFlag flag;
    protected transient Eval eval;

    public OnlineComponent(boolean document) {
        this.setDocumentBased(document);
    }

    public OnlineComponent(boolean document, InputStream configuration) {
        this(document);
        this.setConfiguration(configuration);
    }

    public OnlineOptimizer getOptimizer() {
        return this.optimizer;
    }

    public void setOptimizer(OnlineOptimizer optimizer) {
        this.optimizer = optimizer;
    }

    public HyperParameter getHyperParameter() {
        return this.hyper_parameter;
    }

    public void setHyperParameter(HyperParameter hyperparameter) {
        this.hyper_parameter = hyperparameter;
    }

    public FeatureTemplate<N, S> getFeatureTemplate() {
        return this.feature_template;
    }

    public void setFeatureTemplate(FeatureTemplate<N, S> template) {
        this.feature_template = template;
    }

    public void initFeatureTemplate() {
        this.feature_template = new FeatureTemplate(this.config.getFeatureTemplateElement(), this.getHyperParameter());
    }

    public Eval getEval() {
        return this.eval;
    }

    public void setEval(Eval eval) {
        this.eval = eval;
    }

    public NLPFlag getFlag() {
        return this.flag;
    }

    public void setFlag(NLPFlag flag) {
        this.flag = flag;
        if (flag == NLPFlag.EVALUATE && this.eval == null) {
            this.setEval(this.createEvaluator());
        }

    }

    public NLPConfig<N> getConfiguration() {
        return this.config;
    }

    public void setConfiguration(NLPConfig<N> config) {
        this.config = config;
    }

    public NLPConfig<N> setConfiguration(InputStream in) {
        NLPConfig<N> config = new NLPConfig(in);
        this.setConfiguration(config);
        return config;
    }

    public boolean isDocumentBased() {
        return this.document_based;
    }

    public void setDocumentBased(boolean document) {
        this.document_based = document;
    }

    public boolean isTrain() {
        return this.flag == NLPFlag.TRAIN;
    }

    public boolean isDecode() {
        return this.flag == NLPFlag.DECODE;
    }

    public boolean isEvaluate() {
        return this.flag == NLPFlag.EVALUATE;
    }

    public void process(N[] nodes) {
        this.process(this.initState(nodes));
    }

    public void process(List<N[]> document) {
        if (this.document_based) {
            this.process(this.initState(document));
        } else {
            Iterator var2 = document.iterator();

            while(var2.hasNext()) {
                N[] nodes = (N[]) var2.next();
                this.process(nodes);
            }
        }

    }

    public S process(S state) {
        if (!this.isDecode() && !state.saveOracle()) {
            return state;
        } else {
            float[] scores;
            for(int[] top2 = new int[]{0, -1}; !state.isTerminate(); state.next(this.optimizer.getLabelMap(), top2, scores)) {
                FeatureVector x = this.feature_template.createFeatureVector(state, this.isTrain());
                if (this.isTrain()) {
                    String label = state.getOracle();
                    Instance instance = new Instance(label, x);
                    this.optimizer.train(instance);
                    scores = instance.getScores();
                    this.putLabel(instance.getStringLabel(), instance.getGoldLabel());
                    top2[0] = this.hyper_parameter.getLOLS().chooseGold() ? instance.getGoldLabel() : this.getPrediction(state, scores)[0];
                } else {
                    scores = this.optimizer.scores(x);
                    top2 = this.getPrediction(state, scores);
                }
            }

            if (this.isDecode() || this.isEvaluate()) {
                this.postProcess(state);
                if (this.isEvaluate()) {
                    state.evaluate(this.eval);
                }
            }

            return state;
        }
    }

    protected int[] getPrediction(S state, float[] scores) {
        return MLUtils.argmax2(scores);
    }

    protected void putLabel(String label, int index) {
    }

    protected abstract S initState(N[] var1);

    protected abstract S initState(List<N[]> var1);

    public abstract Eval createEvaluator();

    protected abstract void postProcess(S var1);
}
