import darkDesktop from '../../../../assets/graphics/notion-import-review-dark-desktop.webp';
import darkMobile from '../../../../assets/graphics/notion-import-review-dark-mobile.webp';
import lightDesktop from '../../../../assets/graphics/notion-import-review-light-desktop.webp';
import lightMobile from '../../../../assets/graphics/notion-import-review-light-mobile.webp';
import { createSitePalette } from '../../../setup/sitePalette';
import './notion-import-graphic.css';

/** Captured from the app's ImportPlanCard with sample pages and databases. */
export function NotionImportGraphic() {
  const palette = createSitePalette();

  return (
    <picture class="notion-import-graphic">
      <source
        media="(max-width: 480px)"
        srcset={palette() === 'cream' ? lightMobile : darkMobile}
        width={640}
        height={816}
      />
      <img
        src={palette() === 'cream' ? lightDesktop : darkDesktop}
        alt="Notion import review with a product wiki and two databases selected to share with the team."
        width={980}
        height={680}
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}
