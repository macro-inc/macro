package com.macro.preprocess.component.logical;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.javatuples.Pair;

import com.macro.preprocess.component.LogicalComponent;
import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.physical.TextBox;
/**
 * Paragraphs hold a collection of textboxes. This is needed because we do not compress
 * multiple font types into one PhysicalComponent (e.g. one TextBox). For example the paragraph <br>
 * 		| Hello my name is <b>Jacob</b> and I code. OOP | <br>
 * 		| is fun because it has a funny sounding name.  | <br>
 *  Would render as three textboxes due to the bolding: <br>
 *  		(1) Hello my name is <br>
 *  		(2) <b>Jacob</b> <br>
 *  		(3) and I code. OOP <br>
 *  		(4) is fun because it has a funny sounding name. <br>
 *  If the bolding was not present this would register as one textbox. Despite the bolding, it is
 *  often desirable to view this all as one collection of characters (e.g. to do NLP), which is
 *  where this LogicalComponent comes in. This component represents a contiguous portion of text
 *  like a paragraph, but may also be a bulleted list, header, etc.
 *  <br>
 *  <b>A paragraph does not contain text that spans across pages. In that sense 'paragraph' is a misnomer.</b>
 */
public class Paragraph extends LogicalComponent {
	
	protected SSection owningSection;
	protected List<TextBox> textboxes;
	protected int pageId;
	
	public Paragraph() {
		this.textboxes = new ArrayList<TextBox>();
	}
	
	@Override
	public SSection getSection() {
		return this.owningSection;
	}

	@Override
	public void setSection(SSection section) {
		assert((this.owningSection == null || this.owningSection.equals(section)));
		this.owningSection = section;
	}

	public List<TextBox> getTextboxes() {
		Collections.sort(textboxes);
		return this.textboxes;
	}

	public void setTextboxes(List<TextBox> textboxes) {
		this.textboxes = textboxes;
		for (TextBox textbox : textboxes) textbox.setLogicalOwner(this);
	}
	
	public void addTextBox(TextBox textbox) {
		if (!this.textboxes.isEmpty())
			assert(textbox.getPageNum() == this.pageId);
		else
			this.pageId = textbox.getPageNum();
		if (!this.textboxes.contains(textbox))
			this.textboxes.add(textbox);
		textbox.setLogicalOwner(this);
	}
	
	public String getText() {
		Collections.sort(textboxes);
		StringBuilder strbuild = new StringBuilder();
		for (TextBox textbox : this.textboxes) {
			strbuild.append(textbox.getText());
		}
		return strbuild.toString();
	}
	
	/**
	 * @return ((x1, y1),(x2,y2))
	 */
	public Pair<Pair<Float, Float>, Pair<Float, Float>> getBoundingBox() {
		float minX = 0;
		float minY = 0;
		float maxX = 0;
		float maxY = 0;
		for (PhysicalComponent pc : this.textboxes) {
			float x1 = pc.getX();
			float x2 = pc.getX() + pc.getWidth();
			float y1 = pc.getY();
			float y2 = pc.getY() + pc.getHeight();
			minX = Math.min(minX, x1);
			maxX = Math.max(maxX, x2);
			minY = Math.min(minY, y1);
			maxY = Math.max(maxY, y2);
		}
		Pair<Float, Float> top = new Pair<Float, Float>(minX, minY);
		Pair<Float, Float> bot = new Pair<Float, Float>(maxX, maxY);
		return new Pair<Pair<Float, Float>, Pair<Float, Float>>(top, bot);
	}	
}
