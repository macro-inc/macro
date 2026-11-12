import claude from '@icon/wide-claude.svg?url';
import cursor from '@icon/wide-cursor-ide.svg?url';
import austin from '../../../assets/people/austin.jpeg';
import eric from '../../../assets/people/eric.jpeg';
import gabriel from '../../../assets/people/gabriel.webp';
import jacob from '../../../assets/people/jacob-work.webp';
import julia from '../../../assets/people/julia.webp';
import macro from '../../../assets/people/macro-agent.svg?url';
import peter from '../../../assets/people/peter.jpeg';
import rahul from '../../../assets/people/rahul-initials.svg?url';
import teo from '../../../assets/people/teo.webp';
import wolf from '../../../assets/people/wolf.jpeg';

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
  austin: {
    name: 'Austin Barron',
    shortName: 'Austin',
    initials: 'AB',
    photo: austin,
  },
  teo: { name: 'Teo Nys', shortName: 'Teo', initials: 'TN', photo: teo },
  peter: {
    name: 'Peter Chinman',
    shortName: 'Peter',
    initials: 'PC',
    photo: peter,
  },
  wolf: {
    name: 'Wolf Mermelstein',
    shortName: 'Wolf',
    initials: 'WM',
    photo: wolf,
  },
  eric: { name: 'Eric Hayes', shortName: 'Eric', initials: 'EH', photo: eric },
  rahul: {
    name: 'Rahul Batra',
    shortName: 'Rahul',
    initials: 'RB',
    photo: rahul,
  },
  macro: { name: 'Rox', shortName: 'Rox', initials: 'M', photo: macro },
  claude: { name: 'Claude', shortName: 'Claude', initials: 'C', photo: claude },
  cursor: { name: 'Cursor', shortName: 'Cursor', initials: 'C', photo: cursor },
} as const;

export type HomepagePersonId = keyof typeof homepagePeople;
