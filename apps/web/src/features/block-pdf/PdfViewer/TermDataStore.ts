import { useBlockId, useBlockOwner } from '@core/block';
import { type Owner, onCleanup, runWithOwner } from 'solid-js';
import Term from '../model/Term';
import { cleanQuery } from '../util/StringUtils';
import { XMLUtils } from '../util/XMLUtils';

/**
 * Returns a singleton instance of TermDataStore per document id
 * @throws if called outside of a block context
 */
export const keyedTermDataStore = () => {
  const documentId = useBlockId();
  const blockOwner = useBlockOwner();
  if (!blockOwner) {
    throw new Error('term data store has no owner in block context');
  }

  const owners = documentIdToOwners.get(documentId);
  if (!owners) {
    documentIdToOwners.set(documentId, new Set([blockOwner]));
  } else {
    owners.add(blockOwner);
  }

  // This keeps the singleton TermDataStore alive for the lifetime of the block.
  // If there are multiple block references to the same TermDataStore, it will be
  // garbage collected when the last reference is removed.
  return runWithOwner(blockOwner, () => {
    onCleanup(() => {
      const owners = documentIdToOwners.get(documentId);
      owners?.delete(blockOwner);

      if (!owners || owners.size === 0) {
        documentIdToTermDataStore.delete(documentId);
        documentIdToOwners.delete(documentId);
      }
    });

    const instance = documentIdToTermDataStore.get(documentId);
    if (instance) {
      return instance;
    }

    const store = new TermDataStore();
    documentIdToTermDataStore.set(documentId, store);
    return store;
  });
};

const documentIdToOwners = new Map<string, Set<Owner>>();
const documentIdToTermDataStore = new Map<string, TermDataStore>();

class TermDataStore {
  terms: Term[] = [];
  idToTerm: Map<string, Term> = new Map();
  allTerms: Term[] = [];
  #isLoaded: boolean = false;

  constructor() {
    this.terms = [];
    this.idToTerm = new Map();
    this.allTerms = [];
    this.#isLoaded = false;
  }

  getTerms(): Term[] {
    return Array.from(this.idToTerm.values()).map((term) => term.clone());
  }

  get(id: string): Term | null {
    const term = this.idToTerm.get(id);
    if (term) {
      return term.clone();
    }

    return null;
  }

  searchTerms(query: string, terms: Term[]): Term[] {
    /**
     * 1. Filter sections that do not contain the query in the full descriptor
     *    NOTE: Query must be found at the start of a token in the descriptor
     *    The only prefixes that are allowed are 'in', 'un', and 're'
     *
     * 2. Filter out sections with the exact same full title. Keep the first one
     *    that appears in the document.
     *      - the effect is the removal of subsections with the same full title
     *      - the first one that appears in the document will be the parent section
     *
     * 3. Sort by the following criteria:
     *      1) The search query is an exact match on the first token
     *      2) The search query is a prefix match on the first token
     *      3) The search query is an exact match somewhere
     *      4) The number of times the section is referenced in the document
     */
    const escapedQuery = cleanQuery(query);
    const includeRE = new RegExp(`(^| | in| un| re| co|-)${escapedQuery}`);
    let sort1RE = new RegExp(`^${escapedQuery}( |$)`); // Starting exact match
    let sort2RE = new RegExp(`^${escapedQuery}`); // Starting prefix match
    let sort3RE = new RegExp(`(^| )${escapedQuery}( |$)`); // Non-starting exact match

    const isStartingExactMatch: Record<string, any> = {};
    const isStartingPrefixMatch: Record<string, any> = {};
    const isExactMatchSomewhere: Record<string, any> = {};
    const arr = terms.filter((term) => {
      isStartingExactMatch[term.id] = sort1RE.test(term.lowercaseName);
      isStartingPrefixMatch[term.id] = sort2RE.test(term.lowercaseName);
      isExactMatchSomewhere[term.id] = sort3RE.test(term.lowercaseName);
      return includeRE.test(term.lowercaseName);
    });

    return arr.sort((t1, t2) => {
      const t1IsStartingExactMatch = isStartingExactMatch[t1.id];
      const t2IsStartingExactMatch = isStartingExactMatch[t2.id];

      if (t1IsStartingExactMatch === t2IsStartingExactMatch) {
        const t1IsStartingPrefixMatch = isStartingPrefixMatch[t1.id];
        const t2IsStartingPrefixMatch = isStartingPrefixMatch[t2.id];

        if (t1IsStartingPrefixMatch === t2IsStartingPrefixMatch) {
          const t1IsExactMatchSomewhere = isExactMatchSomewhere[t1.id];
          const t2IsExactMatchSomewhere = isExactMatchSomewhere[t2.id];
          if (t1IsExactMatchSomewhere === t2IsExactMatchSomewhere) {
            return t2.numRefs - t1.numRefs;
          } else {
            return t2IsExactMatchSomewhere - t1IsExactMatchSomewhere;
          }
        } else {
          return t2IsStartingPrefixMatch - t1IsStartingPrefixMatch;
        }
      } else {
        return t2IsStartingExactMatch - t1IsStartingExactMatch;
      }
    });
  }

  isLoaded(): boolean {
    return this.#isLoaded;
  }

  load(xml: string) {
    // we only load the terms once per instance
    if (this.#isLoaded) return;

    const terms = XMLUtils.parse(xml).getElementsByTagName('term');
    const sortedTerms = Array.from(terms)
      .sort((a, b) => {
        const aId = a.getAttribute('id') || '';
        const bId = b.getAttribute('id') || '';
        return parseInt(aId) - parseInt(bId);
      })
      .map((termNode) => {
        const id = termNode.getAttribute('id') || '';
        const definition = termNode.getElementsByTagName('definition')[0];
        const name = termNode.getAttribute('name') || '';
        const defPageNum = parseInt(termNode.getAttribute('page') || '');
        const defYPos = parseInt(termNode.getAttribute('y') || '');
        const numRefs =
          termNode
            .getElementsByTagName('references')[0]
            ?.getElementsByTagName('reference')?.length ?? 0;
        const references = termNode
          .getElementsByTagName('references')[0]
          ?.getElementsByTagName('reference');
        const sims = termNode.getAttribute('sims')
          ? (termNode.getAttribute('sims') || '').trim().split(' ')
          : [];
        return new Term({
          name,
          definition,
          id,
          pageNum: defPageNum,
          yPos: defYPos,
          numRefs,
          references,
          sims,
        });
      });

    const ref = this;
    sortedTerms.forEach(function (term) {
      ref.terms.push(term);
      ref.idToTerm.set(term.id, term);
    });

    this.#isLoaded = true;
  }
}
