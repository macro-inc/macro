package com.macro.preprocess.parse;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.json.JSONArray;
import org.json.JSONObject;

import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.Definition;
import com.macro.preprocess.component.logical.Reference;
import com.macro.preprocess.component.logical.Definition.DefType;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextChar;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.util.DictionaryUtil;
import com.macro.preprocess.parse.util.nlp.Stemmer;

/**
 * Detect errors/anomalies in a document. e.g. Duplicate Defined Term, Broken
 * Section Reference
 */
public class AnomalyDetector {

  public static enum AnomalyType {
    DuplicateDefinition,
    DuplicateSection,
    UnusedDefinition,
    MissingSection,
    UncapitalizedDefinitionReference,
    UndefinedTerm
  }

  private static class Anomaly implements Comparable<Anomaly> {
    AnomalyType type;
    PhysicalComponent reference;
    String message;

    public Anomaly(AnomalyType type, PhysicalComponent reference, String message) {
      this.type = type;
      this.reference = reference;
      this.message = message;
    }

    @Override
    public int compareTo(Anomaly o) {
      return this.reference.compareTo(o.reference); // sort by document order
    }
  }

  private TreeSet<Anomaly> anomalies = new TreeSet<Anomaly>();

  /**
   * Add an anomaly detected from somewhere else in the parsing system
   */
  public void addAnomaly(AnomalyType type, PhysicalComponent reference, String message) {
    anomalies.add(new Anomaly(type, reference, message));
  }

  public void detectDuplicateSection(TextToken reference) {
    this.addAnomaly(AnomalyType.DuplicateSection, reference, "The section number " + reference.toString() + " on page "
        + (reference.getPageNum() + 1) + " is a potential duplicate.");
  }

  public void detectBrokenSectionReference(String sectionLiteral, ArrayList<TextToken> numberTokens) {
    if (sectionLiteral == null)
      return;

    String[] ignoreList = AnomalyWordLists.brokenSectionReferenceIgnoreList;

    int index = numberTokens.size();
    if (index < 1)
      return;
    TextToken nextToken = numberTokens.get(index - 1).getNextToken();
    if (nextToken == null) {
      return;
    }
    String nextTokenString = nextToken.toString();
    if (Arrays.stream(ignoreList).anyMatch(nextTokenString.toLowerCase()::contains))
      return;

    if (sectionLiteral.equals("Part"))
      return;
    if (numberTokens.get(0).toString().split("[\\D]").length > 0) {
      if (!numberTokens.get(0).toString().split("[\\D]")[0].equals("")
          && (Integer.parseInt(numberTokens.get(0).toString().split("[\\D]")[0])) > 50)
        return;
    }
    this.addAnomaly(AnomalyType.MissingSection, numberTokens.get(0),
        "No corresponding section was found for " + sectionLiteral + " "
            + numberTokens.stream().map(a -> a.toString()).reduce("", String::concat) + " on page "
            + (numberTokens.get(0).getPageNum() + 1) + ".");
  }

  /**
   * Detect duplicate definitions
   * 
   * @param termToDefList
   */
  public void detectDuplicateDefinitions(Map<String, TreeSet<Definition>> termToDefList) {
    for (TreeSet<Definition> defSet : termToDefList.values()) {
      int size = defSet.size();
      String termString = defSet.first().getDefinitionTermString();

      boolean hasExplicit = false;
      boolean hasImplicit = false;
      for (Definition def : defSet) {
        if (def.type == DefType.EXPLICIT)
          hasExplicit = true;
        else
          hasImplicit = true;

        // Do not count current definition as duplicate if the following phrases (which
        // imply full definition elsewhere) are parsed
        String definitionText = def.getDefinitionText();
        String[] ignoreList = AnomalyWordLists.duplicateDefIndicator;
        if (definitionText != null && Arrays.stream(ignoreList).anyMatch(definitionText.toLowerCase()::contains))
          size--;
      }

      // Do not report error if there are only two definitions and they are not both
      // explicit/implicit
      if (size == 2 && hasExplicit && hasImplicit || size < 2)
        continue;

      String msg = "The term \"" + termString + "\" is defined " + formatTimes(size) + ".";
      this.addAnomaly(AnomalyType.DuplicateDefinition, defSet.first().getDefinitionTerm().first(), msg);
    }
  }

  /**
   * Detect unused definitions (called from @DefinitioFinder). We only say that a
   * term is 'unused' if it is (i) not references in the document and (ii) non of
   * its similar terms are referenced in the document
   * 
   * @param termToDefList
   */
  public void detectUnusedDefinitions(Map<String, TreeSet<Definition>> termToDefList) {
    for (TreeSet<Definition> defs : termToDefList.values()) {
      boolean atLeastOneUsed = defs.parallelStream().map(a -> a.isUsed).reduce(false, (a, b) -> a || b);
      if (!atLeastOneUsed) {
        // Arbitrarily link to the first definition in the similar set
        String term = defs.first().getDefinitionTermString();
        if (Character.isLowerCase(term.charAt(0)))
          continue;
        String msg = "The term \"" + term + "\" is unused.";
        anomalies.add(new Anomaly(AnomalyType.UnusedDefinition, defs.first().getDefinitionTerm().first(), msg));
      }
    }
  }

  public boolean uncapitalizedIsInDefinitionBody(Definition def, TreeSet<TextToken> potentialUncapitalizedTerm) {
    for (TextBox tbox : def.getDefinitionBody()) {
      for (TextToken t : potentialUncapitalizedTerm) {
        // if any token from the potential anomaly exists in the definition body, return
        // true (it is not an anomaly)
        if (tbox.getChildren().contains(t)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Detect uncapitalized definition references
   * 
   * @param termToDefList
   * @throws Exception
   */
  public void detectUncapitalizedDefinitionReferences(Map<String, TreeSet<Definition>> termToDefList) {
    for (TreeSet<Definition> defs : termToDefList.values()) {
      // print all textboxes in first definition body

      for (Reference<Definition> ref : defs.first().getReferences()) {
        TreeSet<TextToken> termArray = ref.getReferenceTokens();
        char charToTest = termArray.first().toString().charAt(0);
        if (termArray.iterator().next().toString().equals("the")) {
          Iterator<TextToken> it = termArray.iterator();
          it.next();
          if (it.hasNext()) {
            // If the first word is "the", check that the proceeding term is capitalized
            charToTest = it.next().toString().charAt(0);
          }
        }
        if (Character.isLowerCase(charToTest) &&
            termArray.size() > 1) {
          if (termArray.size() == 1) {
            if (DictionaryUtil.words.contains(ref.getReferenceTokens().first().toString())) {
              // Do not report error if term is a singular dictionary word
              continue;
            }
          }
          String[] termArrayToString = new String[termArray.size()];
          int i = 0;
          for (TextToken token : termArray) {
            termArrayToString[i] = token.toString();
            i++;
          }
          for (Definition def : defs) {
            if (!uncapitalizedIsInDefinitionBody(def, termArray)) {
              String msg = "The definition reference \"" + String.join(" ", termArrayToString) + "\" is uncapitalized.";
              anomalies.add(
                  new Anomaly(AnomalyType.UncapitalizedDefinitionReference, ref.getReferenceTokens().first(), msg));
            }
          }

        }
      }
    }
  }

  Set<String> punctuation = AnomalyWordLists.punctuationSet;

  // Ignore terms with key word
  String[] ignoreList = AnomalyWordLists.undefinedTermIndicator;

  Set<String> seenUndefinedTerm = new HashSet<String>();

  private boolean undefinedTermFinalCheck(Map<String, TreeSet<Definition>> termToDefList, String stemmedTerm,
      String fullTerm, TextToken token, ArrayList<TextToken> realTokensForFullTerm) {
    boolean anyLogicalOwner = false;
    for (TextToken t : realTokensForFullTerm) {
      if (t.getLogicalOwner() != null) {
        anyLogicalOwner = true;
      }
    }

    return (!termToDefList.containsKey(stemmedTerm) &&
        !seenUndefinedTerm.contains(stemmedTerm.toLowerCase()) &&
        !Arrays.stream(ignoreList).anyMatch(fullTerm.toLowerCase()::contains) &&
        !anyLogicalOwner);
  }

  private void createUndefinedTermAnomaly(String fullTerm, TextToken token, String stemmedTerm,
      ArrayList<TextToken> realTokensForFullTerm) {
    String errorMessage = "The term \"" + fullTerm + "\" may be undefined.";
    anomalies.add(new Anomaly(AnomalyType.UndefinedTerm, token, errorMessage));
    seenUndefinedTerm.add(stemmedTerm.toLowerCase());
  }

  public void detectUndefinedTerms(TextBox tbox, Map<String, TreeSet<Definition>> termToDefList) {
    String fullTerm = "", stemmedTerm = "";
    ArrayList<TextToken> realTokensForFullTerm = new ArrayList<>();
    Iterator<PhysicalComponent> it = tbox.getChildren().iterator();
    TextToken token = (TextToken) it.next();
    // lastChar used to ensure term does not follow end-of-sentence punctuation
    char lastChar = token.toString().charAt(token.toString().length() - 1);

    while (it.hasNext()) {
      token = (TextToken) it.next();
      // if the first character is lowercase or not a letter, and the fullTerm is not
      // empty
      if ((Character.isLowerCase(token.toString().charAt(0)) ||
          !Character.isLetter(token.toString().charAt(0))) &&
          !realTokensForFullTerm.isEmpty()) {
        if (undefinedTermFinalCheck(termToDefList, stemmedTerm, fullTerm, token, realTokensForFullTerm)) {
          createUndefinedTermAnomaly(fullTerm, token.getPrevToken(), stemmedTerm, realTokensForFullTerm);
        }
        realTokensForFullTerm.clear();
        fullTerm = "";
        stemmedTerm = "";
      }
      // else if the first character is uppercase and a letter
      else if (Character.isUpperCase(token.toString().charAt(0)) && Character.isLetter(token.toString().charAt(0))) {
        // Handle first word of term
        if (realTokensForFullTerm.isEmpty()) {
          boolean foundInDictionary = DictionaryUtil.words.contains(token.toString().toLowerCase());

          if ((foundInDictionary &&
              it.hasNext() &&
              (token.getNextToken() != null && ((!token.getNextToken().toString().isEmpty() &&
                  Character.isLetter(token.getNextToken().toString().charAt(0)) &&
                  !Character.isUpperCase(token.getNextToken().toString().charAt(0))) ||
                  (!token.getNextToken().toString().isEmpty() &&
                      !Character.isLetter(token.getNextToken().toString().charAt(0))))))
              ||
              (foundInDictionary &&
                  !it.hasNext())
              ||
              !foundInDictionary) {
            if (!token.toString().isEmpty()) {
              lastChar = token.toString().charAt(token.toString().length() - 1);
            }
            continue;
          }
          if (!punctuation.contains(Character.toString(lastChar)) &&
              token.toString().length() >= 3 &&
              token.toString().matches("[A-Z][a-z|&|']*")) {
            realTokensForFullTerm.clear();
            realTokensForFullTerm.add(token);
            fullTerm = token.toString();
            stemmedTerm = stemString(token.toString());
            if (!it.hasNext() || token.toString().charAt(token.toString().length() - 1) == '.') {
              if (undefinedTermFinalCheck(termToDefList, stemmedTerm, fullTerm, token, realTokensForFullTerm)) {
                createUndefinedTermAnomaly(fullTerm, token, stemmedTerm, realTokensForFullTerm);
              }
              realTokensForFullTerm.clear();
              fullTerm = "";
              stemmedTerm = "";
            }
          }
        } else {
          realTokensForFullTerm.add(token);
          fullTerm = fullTerm.concat(" " + token.toString());
          stemmedTerm = stemmedTerm.concat(" " + stemString(token.toString()));
          if (!it.hasNext()
              || (!token.toString().isEmpty() && token.toString().charAt(token.toString().length() - 1) == '.')) {
            if (undefinedTermFinalCheck(termToDefList, stemmedTerm, fullTerm, token, realTokensForFullTerm)) {
              createUndefinedTermAnomaly(fullTerm, token, stemmedTerm, realTokensForFullTerm);
            }
            realTokensForFullTerm.clear();
            fullTerm = "";
            stemmedTerm = "";
          }
        }
      }
      if (!token.toString().isEmpty()) {
        lastChar = token.toString().charAt(token.toString().length() - 1);
      }
    }
  }

  private String stemString(String term) {
    if (term.length() < 4) {
      return term;
    }
    Stemmer s = new Stemmer();
    s.add(term.toCharArray(), term.length());
    s.stem();
    return s.toString();
  }

  /**
   * Format numbers in the anomaly message
   * 
   * @param numberOfTimes
   * @return formatted string
   */
  private static String formatTimes(int numberOfTimes) {
    switch (numberOfTimes) {
      case 1:
        return "once";
      case 2:
        return "twice";
      case 3:
        return "three times";
      case 4:
        return "four times";
      case 5:
        return "five times";
      case 6:
        return "six times";
      case 7:
        return "seven times";
      case 8:
        return "eight times";
      case 9:
        return "nine times";
      default:
        return numberOfTimes + " times";
    }
  }

  /**
   * Convert anomalies to @JSONArray for delivery to the frontend
   * 
   * @return
   */
  public JSONArray toJSON() {
    JSONArray toret = new JSONArray();
    for (Anomaly a : this.anomalies) {
      boolean referenceSetEmpty = a.reference.getChildren().isEmpty();
      String startHex = referenceSetEmpty ? "000000" : ((TextChar) a.reference.getChildren().first()).hexColorCode;
      String endHex = referenceSetEmpty ? "000000" : ((TextChar) a.reference.getChildren().last()).hexColorCode;
      JSONObject subobj = new JSONObject();
      subobj.put("type", a.type.toString());
      subobj.put("page", a.reference.getPageNum());
      subobj.put("yPos", a.reference.getY());
      subobj.put("xPos", a.reference.getX()); // probably not needed right now
      subobj.put("width", a.reference.getWidth()); // probably not needed right now
      subobj.put("height", a.reference.getHeight()); // probably not needed right now
      subobj.put("message", a.message);
      subobj.put("startHex", startHex);
      subobj.put("endHex", endHex);
      toret.put(subobj);
    }
    return toret;
  }
}
