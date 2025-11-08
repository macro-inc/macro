package com.macro.preprocess.parse;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import com.macro.preprocess.component.logical.Definition;
import com.macro.preprocess.component.logical.Reference;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.component.physical.TextToken;

public class PDF2Overlay {

	PDFDOM dom;
	ExtractLogical el;
	List<Document> pages;
	int id = 0;

	public PDF2Overlay(ExtractLogical el) {
		this.dom = el.pdfDom;
		this.el = el;
		this.pages = new ArrayList<Document>();
		for (int i = 0; i < el.ep.getNumberOfPages(); i++) {
			Document pageDoc = new Document("");
			Element master = pageDoc.createElement("div");
			master.attr("width", Float.toString(el.ep.getPageWidth(i)));
			master.attr("height", Float.toString(el.ep.getPageHeight(i)));
			master.attr("style", "width:100%;height:100%;position:absolute;mix-blend-mode:lighten;");
			master.attr("class", "overlay");
			pageDoc.appendChild(master);
			pages.add(pageDoc);
		}
		this.dom.getAllSections().parallelStream().forEach(s -> addSection(s));
		this.dom.getAllDefinitions().parallelStream().forEach(d -> addDefinition(d));
	}

	public void addDefinition(Definition d) {
		Element parentBox = createElement();
		parentBox.attr("defId", Integer.toString(d.id));
		parentBox.attr("class", "term");
		d.getDefinitionTerm().parallelStream()
				.forEach(t -> createBox(t.getPageNum(), t.getX(), t.getY(), t.getWidth(), t.getHeight(), parentBox));
		d.getReferences().parallelStream().forEach(ref -> addDefinitionReference(ref));
		addElementToPage(parentBox, d.getDefinitionTerm().first().getPageNum());
	}

	public void addSection(SSection s) {
		Element parentBox = createElement();
		parentBox.attr("secId", Integer.toString(s.id));
		parentBox.attr("class", "section");
		TextToken literal = s.getSectionLiteral();
		if (s.getSectionLiteral() != null) {
			createBox(literal.getPageNum(), literal.getX(), literal.getY(), literal.getWidth(),
					literal.getHeight(), parentBox);
		}
		Set<TextToken> title = s.getSectionTitle();
		if (title != null) {
			title.parallelStream()
					.forEach(t -> createBox(t.getPageNum(), t.getX(), t.getY(), t.getWidth(), t.getHeight(), parentBox));
		}
		TextToken number = s.getSectionNumber();
		if (number != null) {
			createBox(number.getPageNum(), number.getX(), number.getY(), number.getWidth(), number.getHeight(), parentBox);
		}
		s.getReferenceMentions().parallelStream().forEach(ref -> addSectionReference(ref));
		addElementToPage(parentBox, s.getStartPage());
	}

	public void addDefinitionReference(Reference<Definition> rd) {
		Element parentBox = createElement();
		parentBox.attr("defId", Integer.toString(rd.getPointerTo().id));
		parentBox.attr("class", "tref");
		rd.getReferenceTokens().parallelStream()
				.forEach(t -> createBox(t.getPageNum(), t.getX(), t.getY(), t.getWidth(), t.getHeight(), parentBox));
		addElementToPage(parentBox, rd.getReferenceTokens().first().getPageNum());
	}

	public void addSectionReference(Reference<SSection> rs) {
		Element parentBox = createElement();
		parentBox.attr("secId", Integer.toString(rs.getPointerTo().id));
		parentBox.attr("class", "sref");
		rs.getReferenceTokens().parallelStream()
				.forEach(t -> createBox(t.getPageNum(), t.getX(), t.getY(), t.getWidth(), t.getHeight(), parentBox));
		addElementToPage(parentBox, rs.getReferenceTokens().first().getPageNum());
	}

	public void createBox(int page, float x, float y, float width, float height,
			Element parentBox) {
		Element child = this.pages.get(page).createElement("div");
		String style = String.format("left: %s;" + "top: %s;" + "width: %s;" + "height: %s;", convertXToPct(x, page),
				convertYToPct(y, page), convertXToPct(width, page), convertYToPct(height, page));
		child.attr("style", style);
		child.attr("id", "b_" + Integer.toString(++this.id));
		synchronized(parentBox) {
			parentBox.appendChild(child);
		}
	}
	
	public Element createElement() {
		return this.pages.get(0).createElement("div");
	}
	
	public void addElementToPage(Element box, int page) {
		synchronized (this.pages) {
			Document pageDoc = this.pages.get(page);
			pageDoc.child(0).appendChild(box);
		}
	}

	private String convertXToPct(float x, int page) {
		return Float.toString(x / el.ep.getPageWidth(page) * 100f) + "%";
	}

	private String convertYToPct(float y, int page) {
		return Float.toString(y / el.ep.getPageHeight(page) * 100f) + "%";
	}

	public List<Document> getPages() {
		return this.pages;
	}
}
