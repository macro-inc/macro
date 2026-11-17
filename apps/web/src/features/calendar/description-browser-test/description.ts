import '../../../index.css';
import { calendarDescriptionPreviewHtml } from '../utils/calendar-description-sanitizer';

const preview = document.getElementById('preview');
if (!preview) throw new Error('Missing description preview');
preview.innerHTML = calendarDescriptionPreviewHtml(
  '<p>first</p><p>second</p><ul><li><p>nested</p><p>next</p></li></ul><p>after list</p>'
);
