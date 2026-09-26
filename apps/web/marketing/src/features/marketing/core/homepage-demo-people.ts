import claude from '@icon/wide-claude.svg?url';
import cursor from '@icon/wide-cursor-ide.svg?url';
import gabriel from '../../../assets/people/gabriel.webp';
import jacob from '../../../assets/people/jacob-work.webp';
import julia from '../../../assets/people/julia.webp';
import teo from '../../../assets/people/teo.webp';
import valentina from '../../../assets/people/valentina.webp';

/** Local participants in the homepage's launch example. */
export const homepagePeople = {
  jacob: {
    name: 'Jacob Beckerman',
    shortName: 'Jacob',
    initials: 'JB',
    photo: jacob,
  },
  julia: {
    name: 'Julia Westphal',
    shortName: 'Julia',
    initials: 'JW',
    photo: julia,
  },
  gabriel: {
    name: 'Gabriel Birman',
    shortName: 'Gabriel',
    initials: 'GB',
    photo: gabriel,
  },
  valentina: {
    name: 'Valentina',
    shortName: 'Valentina',
    initials: 'V',
    photo: valentina,
  },
  teo: { name: 'Teo', shortName: 'Teo', initials: 'T', photo: teo },
  claude: { name: 'Claude', shortName: 'Claude', initials: 'C', photo: claude },
  cursor: { name: 'Cursor', shortName: 'Cursor', initials: 'C', photo: cursor },
} as const;

export type HomepagePersonId = keyof typeof homepagePeople;
