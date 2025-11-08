package com.macro.preprocess.component.logical;

import com.macro.preprocess.component.LogicalComponent;
import com.macro.preprocess.component.physical.TextBox;
/**
 * Caption, e.g. for a table or a figure.
 * @author Jacob
 * @param <T> Table or Figure (for now).
 */
public class Caption<T extends LogicalComponent> extends LogicalComponent {
	
	protected TextBox textbox;
	protected T owningTableOrFigure;
	
	public Caption() {}
	
	public Caption(TextBox textbox, T owningTableOrFigure) {
		this.textbox = textbox;
		this.owningTableOrFigure = owningTableOrFigure;
	}

	public TextBox getTextbox() {
		return textbox;
	}

	public T getOwningTableOrFigure() {
		return owningTableOrFigure;
	}

	public void setTextbox(TextBox textbox) {
		this.textbox = textbox;
	}

	public void setOwningTableOrFigure(T owningTableOrFigure) {
		this.owningTableOrFigure = owningTableOrFigure;
	}

	@Override
	public SSection getSection() {
		return this.owningTableOrFigure.getSection();
	}

	@Override
	public void setSection(SSection section) {
		return;
	}
}
