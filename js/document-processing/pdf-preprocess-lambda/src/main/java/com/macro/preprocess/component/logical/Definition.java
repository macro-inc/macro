package com.macro.preprocess.component.logical;

import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import org.apache.commons.lang3.mutable.MutableInt;

import com.macro.preprocess.component.LogicalComponent;
import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.util.Util;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.util.SafeWriter;
import com.macro.preprocess.component.physical.TextChar;

/**
 * Definition, as often provided at the top of legal documents.
 *
 * @author Jacob
 */
public class Definition extends LogicalComponent implements Comparable<Definition> {

  protected SSection owningSection;
  protected TreeSet<TextBox> definitionBody;
  protected TreeSet<TextToken> definitionBodyExtracted; // for non-EXPLICIT extractions
  protected TreeSet<TextToken> definitionTerm;
  protected List<Reference<Definition>> references;
  protected boolean dirty;
  protected String definitionTermString;
  protected String definitionTermStemmedString = null;
  private Set<Definition> similarTerms;
  public final int id;
  public DefType type;
  public boolean isUsed; // does it have at least one reference in the doc?

  /**
   * Type representing how the definition was extracted
   *
   * @author Jacob
   */
  public static enum DefType {
    EXPLICIT, // dedicated paragraph like in the Definition section or schedule -> body = post
              // term tokens
    PARENTETICAL, // parenthetically defined in the body of the document -> body = preceding
                  // context
    QUOTED // defined quoted but not with enclosing parenthesis -> body = surrdounging
           // context but mostly trailing
  }

  public Definition(SSection owningSection, DefType type, MutableInt id) {
    id.increment();
    this.id = id.intValue();
    this.type = type;
    this.owningSection = owningSection;
    this.owningSection.addDefinition(this);
    this.definitionTerm = new TreeSet<TextToken>();
    this.references = new ArrayList<Reference<Definition>>();
    this.definitionBody = new TreeSet<TextBox>();
    this.definitionBodyExtracted = new TreeSet<TextToken>();
    this.similarTerms = new HashSet<Definition>();
    dirty = true;
    isUsed = false;
  }

  public String getTermStartTokenHex() {
    return ((TextChar) this.definitionTerm.first().getChildren().first()).hexColorCode;
  }

  public String getTermEndTokenHex() {
    String potentialEndHex = ((TextChar) this.definitionTerm.last().getChildren().last()).hexColorCode;
    if (potentialEndHex == null) {
      return "";
    }
      if (potentialEndHex.equals("000000")) {
        // We need to get the previous tokens hex color
        Object[] definitionTokens = this.definitionTerm.toArray();
        if(Util.isNonLetter(definitionTokens[definitionTokens.length-1].toString())) {
          if(definitionTokens.length > 1) { // Ensure we never get IndexOutOfBounds
            Object validEndToken = definitionTokens[definitionTokens.length - 2];
            return ((TextChar) ((TextToken) validEndToken).getChildren().last()).hexColorCode;
          }
        }
      }
      return potentialEndHex;
  }

  /**
   * Removes this definition from the DOM. Useful if the definition is determined
   * to be malformed ex post (after creation), since definitions are added to the
   * DOM automatically in the constructor.
   */
  public void remove() {
    this.owningSection.removeDefinition(this);
  }

  public void removeIfEmpty() {
    if (this.getDefinitionTerm().isEmpty())
      this.remove();
  }

  @Override
  public SSection getSection() {
    return this.owningSection;
  }

  public String getDefinitionText() {
    StringBuilder sb = new StringBuilder();
    switch (this.type) {
      case EXPLICIT:
        for (TextBox tbox : this.definitionBody) {
          sb.append(tbox.getText());
          sb.append("\n");
        }
        return sb.toString();
      case PARENTETICAL:
        for (TextToken token : this.definitionBodyExtracted) {
          sb.append(token);
          sb.append(token.isHasEndingSpace() ? " " : "");
        }
        return sb.toString();
      default:
        return null;
    }
  }

  public String getDefinitionXML() throws UnsupportedEncodingException {
    switch (this.type) {
      case EXPLICIT:
        return SafeWriter.getXML(this.definitionBody);
      case PARENTETICAL:
        return "<span>...</span>" + SafeWriter.getXML(this.definitionBodyExtracted).strip()
            + "<span>...</span>\n";
      case QUOTED:
        return "<span>...</span>" + SafeWriter.getXML(this.definitionBodyExtracted).strip()
            + "<span>...</span>\n";
      default:
        return null;
    }

  }

  @Override
  public void setSection(SSection section) {
    section.definitions.add(this);
    this.owningSection = section;
  }

  public List<Reference<Definition>> getReferences() {
    return this.references;
  }

  public void addReference(Reference<Definition> reference) {
    this.references.add(reference);
  }

  public TreeSet<TextBox> getDefinitionBody() {
    return definitionBody;
  }

  public TreeSet<TextToken> getDefinitionBodyExtracted() {
    return definitionBodyExtracted;
  }

  public TreeSet<TextToken> getDefinitionTerm() {
    return definitionTerm;
  }

  public void setDefinitionBody(TreeSet<TextBox> definitionBody) {
    this.definitionBody = definitionBody;
  }

  public void setDefinitionBodyExtracted(TreeSet<TextToken> definitionBodyExtracted) {
    this.definitionBodyExtracted = definitionBodyExtracted;
  }

  public void setDefinitionTerm(TreeSet<TextToken> definitionTerm) {
    this.definitionTerm = definitionTerm;
  }

  public void addToDefinitionBody(TextBox t) {
    t.setLogicalOwner(this);
    this.definitionBody.add(t);
  }

  /**
   * Add a TextToken to the term (not the definition body)
   *
   * @param t
   */
  public void addTokenToDefinitionTerm(TextToken t) {
    t.setLogicalOwner(this);
    this.definitionTerm.add(t);
    this.dirty = true;
  }

  /**
   * Add a TextToken to the body of the definition
   *
   * @param t
   */
  public void addTokenToExtractedBody(TextToken t) {
    this.definitionBodyExtracted.add(t);
  }

  public String getDefinitionTermString() {
    if ((!this.dirty) && (definitionTermString != null))
      return definitionTermString;
    if (this.definitionTerm.isEmpty())
      return null;
    StringBuilder sb = new StringBuilder();
    for (TextToken t : this.definitionTerm) {
      sb.append(t.toString());
      if (t.isHasEndingSpace())
        sb.append(' ');
    }
    this.dirty = false;
    this.definitionTermString = sb.toString().trim();
    return this.definitionTermString;
  }

  public String getDefinitionTermStemmedString() {
    if ((!this.dirty) && (this.definitionTermStemmedString != null))
      return this.definitionTermStemmedString;
    if (this.definitionTerm.isEmpty())
      return null;
    StringBuilder sb = new StringBuilder();

    int i = 0;
    int length = this.definitionTerm.size();
    for (TextToken t : this.definitionTerm) {
      if ((i == length - 1) || (i == 0)) {
        String s = t.toString();
        if ((s != ".") && (s != ",")) {
          sb.append(t.toStemmedString());
        }
      } else {
        sb.append(t.toStemmedString());

      }
      if (t.isHasEndingSpace()) {
        sb.append(' ');
      }
      i++;
    }

    this.dirty = false;
    this.definitionTermStemmedString = sb.toString().trim().replace(",", "");
    return this.definitionTermStemmedString;
  }

  @Override
  public int compareTo(Definition other) {
    return this.getDefinitionTerm().first().compareTo(other.getDefinitionTerm().first());
  }

  public void setSimilarTerms(Set<Definition> similars) {
    this.similarTerms = similars;
  }

  public Set<Definition> getSimilarTerms() {
    return this.similarTerms;
  }

  public void addSimilarTerm(Definition d) {
    this.similarTerms.add(d);
  }

  public void linkUpReferences() {
    switch (this.type) {
      case EXPLICIT:
        for (TextBox tbox : this.definitionBody) {
          for (PhysicalComponent tt : tbox.getChildren()) {
            LogicalComponent log = tt.getLogicalOwner();
            if (log instanceof Reference) {
              Reference<?> ref = (Reference<?>) log;
              ref.inBodyOf = this;
            }
          }
        }
      case PARENTETICAL:
        for (TextToken tt : this.definitionBodyExtracted) {
          LogicalComponent log = tt.getLogicalOwner();
          if (log instanceof Reference) {
            Reference<?> ref = (Reference<?>) log;
            ref.inBodyOf = this;
          }
        }
      default:
        return;
    }
  }
}
