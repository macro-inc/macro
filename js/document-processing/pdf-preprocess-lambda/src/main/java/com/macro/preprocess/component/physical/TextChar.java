package com.macro.preprocess.component.physical;

import java.awt.Shape;
import java.awt.geom.AffineTransform;
import java.awt.geom.Rectangle2D;
import java.io.IOException;

import com.macro.preprocess.parse.PageInfoCache;
import org.apache.fontbox.util.*;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType3Font;
import org.apache.pdfbox.text.TextPosition;

import com.macro.preprocess.component.LogicalComponent;
import com.macro.preprocess.component.PhysicalComponent;

/**
 * TextChar is a wrapper around TextPosition and is meant to hold a single
 * character. TextChar can only be the child of a TextToken. TextChar cannot
 * have its own logical owner.
 *
 * @author Jacob
 */
public class TextChar extends PhysicalComponent {

  public TextPosition textPosition;
  protected TextToken parent;
  protected float cssHeight;
  PageInfoCache pageInfoCache;
  public String hexColorCode;

  public TextChar(TextPosition textPosition, int pageNum, PDDocument doc, PageInfoCache pageInfoCache,
      String hexColorCode) throws IOException {
    super();
    this.textPosition = textPosition;
    this.pageNum = pageNum;
    this.document = doc;
    this.pageInfoCache = pageInfoCache;
    this.permitsChildren = false;
    this.hexColorCode = hexColorCode;

    // Size for rendering SVG...
    this.cssHeight = textPosition.getXScale();

    // Size for bounding box...
    AffineTransform flipAT = new AffineTransform();
    flipAT.translate(0, this.pageInfoCache.getPageHeight(pageNum));
    flipAT.scale(1, -1);
    PDFont font = textPosition.getFont();
    BoundingBox bbox = font.getBoundingBox();
    AffineTransform at = textPosition.getTextMatrix().createAffineTransform();
    float xadvance = font.getWidth(textPosition.getCharacterCodes()[0]);
    Rectangle2D.Float rect = new Rectangle2D.Float(0, bbox.getLowerLeftY(), xadvance, bbox.getHeight());
    if (font instanceof PDType3Font) {
      at.concatenate(font.getFontMatrix().createAffineTransform());
    } else {
      at.scale(1 / 1000f, 1 / 1000f);
    }
    Shape s = at.createTransformedShape(rect);
    s = flipAT.createTransformedShape(s);
    Rectangle2D finalBox = s.getBounds2D();
    this.width = (float) finalBox.getWidth();
    this.height = (float) finalBox.getHeight();
    this.x = (float) finalBox.getX();
    this.y = (float) finalBox.getY();
  }

  @Override
  public TextToken getParent() {
    return this.parent;
  }

  public void setParent(TextToken parent) throws IOException {
    this.parent = parent;
    this.parent.addChild(this);
  }

  @Override
  public LogicalComponent getLogicalOwner() {
    if (this.parent == null)
      return null;
    return this.parent.getLogicalOwner();
  }

  @Override
  public void setLogicalOwner(LogicalComponent logicalOwner) {
    return;
  }

  public float getCssHeight() {
    return cssHeight;
  }

}
