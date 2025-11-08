package com.macro.preprocess.nlp;

import com.macro.preprocess.nlp.dictionary.Abbreviation;
import com.macro.preprocess.nlp.dictionary.Compound;
import com.macro.preprocess.nlp.dictionary.EnglishApostrophe;
import com.macro.preprocess.nlp.dictionary.EnglishHyphen;
import com.macro.preprocess.nlp.token.Token;
import com.macro.preprocess.nlp.token.TokenIndex;
import com.macro.preprocess.utils.Language;
import com.macro.preprocess.utils.PatternUtils;
import com.macro.preprocess.utils.StringUtils;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class EnglishTokenizer extends Tokenizer {
    private final String[] L_BRACKETS = new String[]{"\"", "(", "{", "["};
    private final String[] R_BRACKETS = new String[]{"\"", ")", "}", "]"};
    private final Pattern P_MID_SYM = PatternUtils.createClosedPattern("(\\p{Alpha}{2,}+)([\\.\\!\\?]+)(\\p{Alpha}{2,}+)");
    private EnglishApostrophe d_apostrophe = new EnglishApostrophe();
    private Abbreviation d_abbreviation = new Abbreviation();
    private Compound d_compound;
    private EnglishHyphen d_hyphen;

    public EnglishTokenizer() {
        this.d_compound = new Compound(Language.ENGLISH);
        this.d_hyphen = new EnglishHyphen();
    }

    protected int adjustFirstNonSymbolGap(char[] cs, int beginIndex, String t) {
        return 0;
    }

    protected int adjustLastSymbolSequenceGap(char[] cs, int endIndex, String t) {
        char sym = cs[endIndex];
        return sym == '.' && this.d_abbreviation.isAbbreviationEndingWithPeriod(StringUtils.toLowerCase(t)) ? 1 : 0;
    }

    protected boolean preserveSymbolInBetween(char[] cs, int index) {
        return this.d_hyphen.preserveHyphen(cs, index);
    }

    protected boolean tokenizeWordsMore(List<Token> tokens, String original, String lower, char[] lcs, TokenIndex bIndex2) {
        return this.tokenize(tokens, original, lower, lcs, this.d_apostrophe, bIndex2) || this.tokenize(tokens, original, lower, lcs, this.d_compound, bIndex2);
    }

    protected int tokenizeMiddleSymbol(List<Token> tokens, String token, String lower, int index) {
        Matcher m = this.P_MID_SYM.matcher(token);
        return m.find() ? this.addTokens(m, tokens, index, 2, 3, 4) : 0;
    }

    public <T extends Token> List<List<T>> segmentize(List<T> tokens) {
        List<List<T>> sentences = new ArrayList();
        int[] brackets = new int[this.R_BRACKETS.length];
        int size = tokens.size();
        boolean isTerminal = false;
        int i = 0;

        int bIndex;
        for(bIndex = 0; i < size; ++i) {
            String token = ((Token)tokens.get(i)).getWordForm();
            this.countBrackets(token, brackets);
            if (isTerminal || this.isFinalMarksOnly(token)) {
                if (i + 1 < size && this.isFollowedByBracket(((Token)tokens.get(i + 1)).getWordForm(), brackets)) {
                    isTerminal = true;
                } else {
                    sentences.add(tokens.subList(bIndex, bIndex = i + 1));
                    isTerminal = false;
                }
            }
        }

        if (bIndex < size) {
            sentences.add(tokens.subList(bIndex, size));
        }

        return sentences;
    }

    public Token[] getSubArray(List<Token> tokens, int beginIndex, int endIndex) {
        Token[] array = new Token[endIndex - beginIndex];
        int i = beginIndex;

        for(int j = 0; i < endIndex; ++j) {
            array[j] = (Token)tokens.get(i);
            ++i;
        }

        return array;
    }

    private void countBrackets(String str, int[] brackets) {
        if (str.equals("\"")) {
            brackets[0] += brackets[0] == 0 ? 1 : -1;
        } else {
            int size = brackets.length;

            for(int i = 1; i < size; ++i) {
                int var10002;
                if (str.equals(this.L_BRACKETS[i])) {
                    var10002 = brackets[i]++;
                } else if (str.equals(this.R_BRACKETS[i])) {
                    var10002 = brackets[i]--;
                }
            }
        }

    }

    private boolean isFollowedByBracket(String str, int[] brackets) {
        int size = this.R_BRACKETS.length;

        for(int i = 0; i < size; ++i) {
            if (brackets[i] > 0 && str.equals(this.R_BRACKETS[i])) {
                return true;
            }
        }

        return false;
    }
}