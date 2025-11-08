package com.macro.preprocess.nlp;

import com.macro.preprocess.nlp.constants.StringConst;
import com.macro.preprocess.nlp.dictionary.Currency;
import com.macro.preprocess.nlp.dictionary.Dictionary;
import com.macro.preprocess.nlp.dictionary.Emoticon;
import com.macro.preprocess.nlp.dictionary.Unit;
import com.macro.preprocess.nlp.token.Token;
import com.macro.preprocess.nlp.token.TokenIndex;
import com.macro.preprocess.utils.*;
import it.unimi.dsi.fastutil.chars.CharOpenHashSet;
import it.unimi.dsi.fastutil.chars.CharSet;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.magicwerk.brownies.collections.GapList;

public abstract class Tokenizer {
    protected final CharSet S_SYMBOL_IN_BETWEEN = new CharOpenHashSet(new char[]{';', ',', '~', '=', '+', '&', '|', '/'});
    protected final Pattern P_ABBREVIATION = PatternUtils.createClosedPattern("\\p{Alnum}([\\.|-]\\p{Alnum})*");
    protected final Pattern P_YEAR = PatternUtils.createClosedPattern("\\d\\d['’]?[sS]?");
    protected final Pattern P_YEAR_YEAR = PatternUtils.createClosedPattern("(\\d{2}|\\d{4})(-)(\\d{2}|\\d{4}|\\d{2}[sS])");
    protected Emoticon d_emoticon = new Emoticon();
    protected Currency d_currency = new Currency();
    protected Unit d_unit = new Unit();
    protected Set<String> d_preserve = this.initPreserve();
    protected HashMap<String, int[]> metaRangeCache = new HashMap<>();

    public Tokenizer() {
    }

    private Set<String> initPreserve() {
        BufferedReader reader = IOUtils.createBufferedReader(IOUtils.getInputStreamsFromResource(Dictionary.ROOT + "preserve.txt"));
        Set<String> set = new HashSet();

        String line;
        try {
            while((line = reader.readLine()) != null) {
                set.add(line.trim());
            }
        } catch (IOException var5) {
            var5.printStackTrace();
        }

        return set;
    }

    public List<Token> tokenize(InputStream in) {
        BufferedReader reader = IOUtils.createBufferedReader(in);
        ArrayList<Token> tokens = new ArrayList();
        int start = 0;
        int end = 0;
        boolean flag = false;

        try {
            String line;
            while((line = reader.readLine()) != null) {
                if (flag) {
                    start = end + System.getProperty("line.separator").length();
                    end = start + line.length();
                } else {
                    start = 0;
                    end = line.length();
                    flag = true;
                }

                List<Token> t = this.tokenizeWhiteSpaces(line, start);
                if (!t.isEmpty()) {
                    tokens.addAll(t);
                }
            }

            reader.close();
        } catch (IOException var10) {
            var10.printStackTrace();
        }

        tokens.trimToSize();
        return tokens;
    }

    public List<Token> tokenize(String s) {
        return this.tokenizeWhiteSpaces(s, 0);
    }

    public List<List<Token>> segmentize(InputStream in) {
        return this.segmentize(this.tokenize(in));
    }

    public List<List<Token>> segmentize(String s) {
        return this.segmentize(this.tokenize(s));
    }

    public void tokenizeLine(InputStream in, PrintStream out, String delim, int flag) {
        BufferedReader reader = IOUtils.createBufferedReader(in);

        String line;
        try {
            while((line = reader.readLine()) != null) {
                List<Token> tokens = this.tokenize(line);
                Token token;
                String s;
                if (flag > 0) {
                    for(Iterator var8 = tokens.iterator(); var8.hasNext(); token.setWordForm(s)) {
                        token = (Token)var8.next();
                        s = token.getWordForm();
                        switch (flag) {
                            case 1:
                                s = StringUtils.toSimplifiedForm(s, false);
                                break;
                            case 2:
                                s = StringUtils.toSimplifiedForm(s, true);
                        }
                    }
                }

                line = Joiner.join(tokens, delim);
                out.println(line);
            }
        } catch (IOException var11) {
            var11.printStackTrace();
        }

    }

    public abstract <T extends Token> List<List<T>> segmentize(List<T> var1);

    private List<Token> tokenizeWhiteSpaces(String s, int start) {
        List<Token> tokens = new GapList();
        int len = s.length();
        int bIndex = start;
        char[] cs = s.toCharArray();

        for(int i = start; i < start + len; ++i) {
            if (CharUtils.isWhiteSpace(cs[i - start])) {
                if (bIndex < i) {
                    this.tokenizeMetaInfo(tokens, s.substring(bIndex - start, i - start), bIndex, i);
                }

                bIndex = i + 1;
            }
        }

        if (bIndex < start + len) {
            this.tokenizeMetaInfo(tokens, s.substring(bIndex - start), bIndex, len - bIndex + start);
        }

        if (!tokens.isEmpty()) {
            this.finalize(tokens, s);
        }

        return tokens;
    }

    private void tokenizeMetaInfo(List<Token> tokens, String s, int bIndex2, int i) {
        TokenIndex bIndex3 = new TokenIndex(bIndex2);
        int[] ps;
        if ((ps = this.getMetaRange(s)) != null) {
            int bIndex = ps[0];
            int eIndex = ps[1];
            int len = s.length();
            if (0 < bIndex) {
                this.tokenizeSymbols(tokens, s.substring(0, bIndex), bIndex3);
            }

            Token Token = new Token(s.substring(bIndex, eIndex), bIndex3.getVal(), bIndex3.getVal() + eIndex - bIndex);
            tokens.add(Token);
            bIndex3.setVal(bIndex3.getVal() + eIndex - bIndex);
            if (eIndex < len) {
                this.tokenizeSymbols(tokens, s.substring(eIndex), bIndex3);
            }
        } else {
            this.tokenizeSymbols(tokens, s, bIndex3);
        }

    }

    private int[] getMetaRange(String s) {
		if (this.metaRangeCache.containsKey(s)) {
			return this.metaRangeCache.get(s);
		}

		if (!MetaUtils.startsWithNetworkProtocol(s) && !this.d_preserve.contains(s)) {
			int[] ps;
			if ((ps = this.d_emoticon.getEmoticonRange(s)) != null) {
				this.metaRangeCache.put(s, ps);
				return ps;
			} else {
				Matcher m = MetaUtils.FAST_HYPERLINK.matcher(s);
				if (m.find()) {
					int[] result = { m.start(), m.end() };
					this.metaRangeCache.put(s, result);
					return result;
				}
			}
		}

		this.metaRangeCache.put(s, null);
		return null;
    }

    private void tokenizeSymbols(List<Token> tokens, String s, TokenIndex bIndex2) {
        char[] cs = s.toCharArray();
        int len = s.length();
        int bIndex = this.getFirstNonSymbolIndex(cs);
        if (bIndex == len) {
            this.addSymbols(tokens, s, bIndex2);
        } else {
            int eIndex = this.getLastSymbolSequenceIndex(cs);
            List<int[]> indices = new ArrayList();
            indices.add(new int[]{0, bIndex});
            this.addNextSymbolSequenceIndices(indices, cs, bIndex + 1, eIndex - 1);
            indices.add(new int[]{eIndex, len});
            this.tokenizeSymbolsAux(tokens, s, cs, indices, bIndex2);
        }
    }

    private int getFirstNonSymbolIndex(char[] cs) {
        int len = cs.length;

        int i;
        for(i = 0; i < len; ++i) {
            if (!this.isSymbol(cs[i])) {
                return i;
            }
        }

        return i;
    }

    private int getLastSymbolSequenceIndex(char[] cs) {
        int i;
        for(i = cs.length - 1; i >= 0; --i) {
            if (!this.isSymbol(cs[i])) {
                return i + 1;
            }
        }

        return i + 1;
    }

    private void addNextSymbolSequenceIndices(List<int[]> indices, char[] cs, int bIndex, int eIndex) {
        for(int i = bIndex; i < eIndex; ++i) {
            if (!this.preserveSymbolInBetween(cs, i) && !this.preserveSymbolInDigits(cs, i) && !this.preserveSymbolInAlphabets(cs, i) && (this.isEllipsis(cs, i) || this.isSymbolInBetween(cs[i]) || i + 1 < eIndex && this.isSymbolInBetween(cs[i + 1]) && CharUtils.isFinalMark(cs[i]))) {
                int j = this.getSpanIndex(cs, i, eIndex, false);
                indices.add(new int[]{i, j});
                i = j - 1;
            }
        }

    }

    private void tokenizeSymbolsAux(List<Token> tokens, String s, char[] cs, List<int[]> indices, TokenIndex bIndex2) {
        int size = indices.size() - 1;

        int i;
        int bIndex;
        int eIndex;
        int[] pi;
        int[] ni;
        String t;
        for(i = 0; i < size; ++i) {
            pi = (int[])indices.get(i);
            ni = (int[])indices.get(i + 1);
            bIndex = pi[1];
            eIndex = ni[0];
            if (bIndex < eIndex) {
                t = s.substring(bIndex, eIndex);
                int pg = pi[1] - pi[0];
                int ng = ni[1] - ni[0];
                boolean pb = i == 0 ? pg > 0 : pg == 1;
                boolean nb = i + 1 == size ? ng > 0 : ng == 1;
                if (pb) {
                    pi[1] = this.adjustFirstNonSymbolIndex(cs, bIndex, t);
                }

                if (nb) {
                    ni[0] = this.adjustLastSymbolSequenceIndex(cs, eIndex, t);
                }
            }
        }

        for(i = 0; i < size; ++i) {
            pi = (int[])indices.get(i);
            ni = (int[])indices.get(i + 1);
            bIndex = pi[0];
            eIndex = pi[1];
            if (bIndex < eIndex) {
                t = s.substring(bIndex, eIndex);
                if (i == 0) {
                    bIndex2.setVal(this.addSymbols(tokens, t, bIndex2));
                } else {
                    Token Token = new Token(t, bIndex2.getVal(), bIndex2.getVal() + t.length());
                    tokens.add(Token);
                    bIndex2.setVal(bIndex2.getVal() + t.length());
                }
            }

            bIndex = pi[1];
            eIndex = ni[0];
            if (bIndex < eIndex) {
                t = s.substring(bIndex, eIndex);
                bIndex2.setVal(this.addMorphemes(tokens, t, bIndex2));
            }
        }

        ni = (int[])indices.get(size);
        bIndex = ni[0];
        eIndex = ni[1];
        if (bIndex < eIndex) {
            bIndex2.setVal(this.addSymbols(tokens, s.substring(bIndex, eIndex), bIndex2));
        }

    }

    private int adjustFirstNonSymbolIndex(char[] cs, int beginIndex, String t) {
        char sym = cs[beginIndex - 1];
        char curr = cs[beginIndex];
        int gap;
        if ((gap = this.adjustFirstNonSymbolGap(cs, beginIndex, t)) > 0) {
            beginIndex -= gap;
        } else if (CharUtils.isPreDigitSymbol(sym)) {
            if (CharUtils.isDigit(curr)) {
                --beginIndex;
            }
        } else if (sym != '@' && sym != '#') {
            if (CharUtils.isApostrophe(sym) && this.P_YEAR.matcher(t).find()) {
                --beginIndex;
            }
        } else if (CharUtils.isAlphabet(curr)) {
            --beginIndex;
        }

        return beginIndex;
    }

    protected int adjustLastSymbolSequenceIndex(char[] cs, int endIndex, String t) {
        String lower = StringUtils.toLowerCase(t);
        char sym = cs[endIndex];
        int gap;
        if ((gap = this.adjustLastSymbolSequenceGap(cs, endIndex, t)) > 0) {
            endIndex += gap;
        } else if (sym == '$') {
            if (this.d_currency.isCurrencyDollar(lower)) {
                ++endIndex;
            }
        } else if (sym == '.' && this.preservePeriod(cs, endIndex, t)) {
            ++endIndex;
        }

        return endIndex;
    }

    protected abstract int adjustFirstNonSymbolGap(char[] var1, int var2, String var3);

    protected abstract int adjustLastSymbolSequenceGap(char[] var1, int var2, String var3);

    private int addSymbols(List<Token> tokens, String s, TokenIndex bIndex2) {
        if (s.length() == 1) {
            Token Token = new Token(s, bIndex2.getVal(), bIndex2.getVal() + 1);
            tokens.add(Token);
            bIndex2.setVal(bIndex2.getVal() + 1);
            return bIndex2.getVal();
        } else {
            int len = s.length();
            int bIndex = 0;
            char[] cs = s.toCharArray();

            int j;
            Token Token;
            for(int i = 0; i < len; i = j) {
                int flag = this.getSymbolFlag(cs[i]);
                j = this.getSpanIndex(cs, i, len, flag == 1);
                if (0 < flag || i + 1 < j) {
                    if (bIndex < i) {
                        Token = new Token(s.substring(bIndex, i), bIndex2.getVal(), bIndex2.getVal() + i - bIndex);
                        tokens.add(Token);
                        bIndex2.setVal(bIndex2.getVal() + i - bIndex);
                    }

                    Token = new Token(s.substring(i, j), bIndex2.getVal(), bIndex2.getVal() + j - i);
                    tokens.add(Token);
                    bIndex2.setVal(bIndex2.getVal() + j - i);
                    bIndex = j;
                }
            }

            if (bIndex < len) {
                Token = new Token(s.substring(bIndex), bIndex2.getVal(), bIndex2.getVal() + len - bIndex);
                tokens.add(Token);
                bIndex2.setVal(bIndex2.getVal() + len - bIndex);
            }

            return bIndex2.getVal();
        }
    }

    private int getSpanIndex(char[] cs, int index, int rightBound, boolean finalMark) {
        char c = cs[index];

        int i;
        for(i = index + 1; i < rightBound; ++i) {
            if (!this.isConsecutive(cs, i, c, finalMark)) {
                return i;
            }
        }

        return i;
    }

    private int addMorphemes(List<Token> tokens, String s, TokenIndex bIndex2) {
        if (s.length() == 1) {
            Token Token = new Token(s, bIndex2.getVal(), bIndex2.getVal() + 1);
            tokens.add(Token);
            bIndex2.setVal(bIndex2.getVal() + 1);
            return bIndex2.getVal();
        } else {
            char[] lcs = s.toCharArray();
            String lower = CharUtils.toLowerCase(lcs) ? new String(lcs) : s;
            if (!this.tokenize(tokens, s, lower, lcs, this.d_currency, bIndex2) && !this.tokenize(tokens, s, lower, lcs, this.d_unit, bIndex2) && !this.tokenizeDigit(tokens, s, lcs, bIndex2) && !this.tokenizeWordsMore(tokens, s, lower, lcs, bIndex2)) {
                Token Token = new Token(s, bIndex2.getVal(), bIndex2.getVal() + s.length());
                tokens.add(Token);
                bIndex2.setVal(bIndex2.getVal() + s.length());
                return bIndex2.getVal();
            } else {
                return bIndex2.getVal();
            }
        }
    }

    protected boolean tokenize(List<Token> tokens, String original, String lower, char[] lcs, Dictionary tokenizer, TokenIndex bIndex2) {
        String[] t = tokenizer.tokenize(original, lower, lcs);
        if (t != null) {
            bIndex2.setVal(this.addAll(tokens, t, bIndex2.getVal()));
            return true;
        } else {
            return false;
        }
    }

    public int addAll(List<Token> tokens, String[] array, int bIndex2) {
        String[] var4 = array;
        int var5 = array.length;

        for(int var6 = 0; var6 < var5; ++var6) {
            String item = var4[var6];
            Token interval = new Token(item, bIndex2, bIndex2 + item.length());
            tokens.add(interval);
            bIndex2 += item.length();
        }

        return bIndex2;
    }

    private boolean tokenizeDigit(List<Token> tokens, String original, char[] lcs, TokenIndex bIndex2) {
        int len = lcs.length;
        if (len < 2) {
            return false;
        } else {
            Token Token;
            Token newinterval;
            if (this.tokenizeDigitAux(lcs[0]) && CharUtils.containsDigitPunctuationOnly(lcs, 1, len)) {
                Token = new Token(original.substring(0, 1), bIndex2.getVal(), bIndex2.getVal() + 1);
                tokens.add(Token);
                bIndex2.setVal(bIndex2.getVal() + 1);
                newinterval = new Token(original.substring(1), bIndex2.getVal(), bIndex2.getVal() + original.length() - 1);
                tokens.add(newinterval);
                bIndex2.setVal(bIndex2.getVal() + original.length() - 1);
                return true;
            } else {
                --len;
                if (this.tokenizeDigitAux(lcs[len]) && CharUtils.containsDigitPunctuationOnly(lcs, 0, len)) {
                    Token = new Token(original.substring(0, len), bIndex2.getVal(), bIndex2.getVal() + len);
                    tokens.add(Token);
                    bIndex2.setVal(bIndex2.getVal() + len);
                    newinterval = new Token(original.substring(len), bIndex2.getVal(), bIndex2.getVal() + original.length() - len);
                    tokens.add(newinterval);
                    bIndex2.setVal(bIndex2.getVal() + original.length() - len);
                    return true;
                } else {
                    return false;
                }
            }
        }
    }

    private boolean tokenizeDigitAux(char c) {
        return c == '#' || c == '$' || c == '%' || c == '*' || c == '=';
    }

    protected abstract boolean tokenizeWordsMore(List<Token> var1, String var2, String var3, char[] var4, TokenIndex var5);

    private void finalize(List<Token> tokens, String input) {
        int size = tokens.size();

        for(int i = 0; i < size; ++i) {
            String token = ((Token)tokens.get(i)).getWordForm();
            String lower = StringUtils.toLowerCase(token);
            int j;
            if ((j = this.tokenizeNo(tokens, token, lower, i)) != 0 || this.mergeBrackets(tokens, token, i, input) != 0 || (j = this.tokenizeYears(tokens, token, i)) != 0 || (j = this.tokenizeMiddleSymbol(tokens, token, lower, i)) != 0) {
                size = tokens.size();
                i += j;
            }
        }

        if (tokens.size() == 1) {
            this.tokenizeLastPeriod(tokens);
        }

    }

    private int tokenizeNo(List<Token> tokens, String token, String lower, int index) {
        if (!lower.equals("no.") || index + 1 != tokens.size() && CharUtils.isDigit(((Token)tokens.get(index + 1)).getWordForm().charAt(0))) {
            return 0;
        } else {
            Token currToken = (Token)tokens.get(index);
            Token Token = new Token(StringUtils.trim(currToken.getWordForm(), 1), currToken.getStartOffset(), currToken.getEndOffset() - 1);
            tokens.set(index, Token);
            Token nextInterval = new Token(StringConst.PERIOD, currToken.getEndOffset() - 1, currToken.getEndOffset());
            tokens.add(index + 1, nextInterval);
            return 1;
        }
    }

    private int mergeBrackets(List<Token> tokens, String token, int index, String input) {
        if ((token.length() == 1 || StringUtils.containsDigitOnly(token)) && 0 <= index - 1 && index + 1 < tokens.size()) {
            Token prevToken = (Token)tokens.get(index - 1);
            Token nextToken = (Token)tokens.get(index + 1);
            if (CharUtils.isLeftBracket(prevToken.getWordForm().charAt(0)) && CharUtils.isRightgBracket(nextToken.getWordForm().charAt(0))) {
                Token currToken = (Token)tokens.get(index);
                Token Token = new Token(prevToken.getWordForm() + currToken.getWordForm() + nextToken.getWordForm(), prevToken.getStartOffset(), nextToken.getEndOffset());
                tokens.set(index - 1, Token);
                tokens.remove(index);
                tokens.remove(index);
                return -1;
            }
        }

        return 0;
    }

    private int tokenizeYears(List<Token> tokens, String token, int index) {
        Matcher m = this.P_YEAR_YEAR.matcher(token);
        return m.find() ? this.addTokens(m, tokens, index, 2, 3, 4) : 0;
    }

    protected int addTokens(Matcher m, List<Token> tokens, int index, int... ids) {
        Token curr = (Token)tokens.get(index);
        curr.setWordForm(m.group(ids[0]));
        curr.resetEndOffset();

        for(int i = 1; i < ids.length; ++i) {
            Token prev = curr;
            curr = new Token(m.group(ids[i]));
            curr.setStartOffset(prev.getEndOffset());
            curr.resetEndOffset();
            tokens.add(index + i, curr);
        }

        return ids.length - 1;
    }

    protected abstract int tokenizeMiddleSymbol(List<Token> var1, String var2, String var3, int var4);

    private void tokenizeLastPeriod(List<Token> tokens) {
        int lastIndex = tokens.size() - 1;
        Token lastInterval = (Token)tokens.get(lastIndex);
        String lastToken = lastInterval.getWordForm();
        char[] ca = lastToken.toCharArray();
        int leng = lastToken.length();
        if (1 < leng && ca[leng - 1] == '.' && !CharUtils.isFinalMark(ca[leng - 2])) {
            Token Token = new Token(StringUtils.trim(lastToken, 1), lastInterval.getStartOffset(), lastInterval.getEndOffset() - 1);
            tokens.set(lastIndex, Token);
            Token nextInterval = new Token(StringConst.PERIOD, lastInterval.getEndOffset() - 1, lastInterval.getEndOffset());
            tokens.add(lastIndex + 1, nextInterval);
        }

    }

    protected abstract boolean preserveSymbolInBetween(char[] var1, int var2);

    private boolean preserveSymbolInDigits(char[] cs, int index) {
        char c = cs[index];
        if (CharUtils.isHyphen(c)) {
            return 0 <= index - 1 && index + 1 < cs.length && CharUtils.isAlnum(cs[index - 1]) && CharUtils.isDigit(cs[index + 1]);
        } else if (c == '/') {
            return 0 <= index - 1 && index + 1 < cs.length && CharUtils.isDigit(cs[index - 1]) && CharUtils.isDigit(cs[index + 1]);
        } else if (cs[index] != ',') {
            return false;
        } else {
            return 0 <= index - 1 && index + 3 < cs.length && (index + 4 == cs.length || !CharUtils.isDigit(cs[index + 4])) && CharUtils.isDigit(cs[index - 1]) && CharUtils.isDigit(cs[index + 1]) && CharUtils.isDigit(cs[index + 2]) && CharUtils.isDigit(cs[index + 3]);
        }
    }

    private boolean preserveSymbolInAlphabets(char[] cs, int index) {
        char c = cs[index];
        if (c != '&') {
            return false;
        } else {
            return 0 <= index - 1 && index + 1 < cs.length && CharUtils.isAlphabet(cs[index - 1]) && CharUtils.isAlphabet(cs[index + 1]);
        }
    }

    protected boolean preservePeriod(char[] cs, int endIndex, String t) {
        int c;
        if (endIndex + 1 < cs.length) {
            c = cs[endIndex + 1];
            if (CharUtils.isSeparatorMark((char)c)) {
                return true;
            }

            if (CharUtils.isFinalMark((char)c) || CharUtils.isQuotationMark((char)c)) {
                return false;
            }
        }

        if (this.P_ABBREVIATION.matcher(t).find()) {
            return true;
        } else {
            c = t.length();
            return 2 <= c && c <= 5 && CharUtils.containsOnlyConsonants(t);
        }
    }

    private boolean isSymbol(char c) {
        return CharUtils.isPunctuation(c) || CharUtils.isGeneralPunctuation(c) || CharUtils.isCurrency(c) || CharUtils.isArrow(c);
    }

    private boolean isEllipsis(char[] cs, int index) {
        if (CharUtils.isFinalMark(cs[index]) && index + 1 < cs.length) {
            char c = cs[index + 1];
            return CharUtils.isFinalMark(c) || CharUtils.isSeparatorMark(c) || CharUtils.isQuotationMark(c);
        } else {
            return false;
        }
    }

    private boolean isSymbolInBetween(char c) {
        return CharUtils.isBracket(c) || CharUtils.isArrow(c) || CharUtils.isDoubleQuotationMark(c) || CharUtils.isHyphen(c) || this.S_SYMBOL_IN_BETWEEN.contains(c);
    }

    private boolean isConsecutive(char[] cs, int index, char c, boolean finalMark) {
        return finalMark ? CharUtils.isFinalMark(cs[index]) : c == cs[index];
    }

    private int getSymbolFlag(char c) {
        if (CharUtils.isFinalMark(c)) {
            return 1;
        } else {
            return !CharUtils.isBracket(c) && !CharUtils.isSeparatorMark(c) && !CharUtils.isQuotationMark(c) && c != '`' ? 0 : 2;
        }
    }

    protected boolean isFinalMarksOnly(String s) {
        char[] var2 = s.toCharArray();
        int var3 = var2.length;

        for(int var4 = 0; var4 < var3; ++var4) {
            char c = var2[var4];
            if (!CharUtils.isFinalMark(c)) {
                return false;
            }
        }

        return true;
    }
}
