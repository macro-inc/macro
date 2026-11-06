import type { SizeOffer } from '@service-auth/computers';

/** Scripted prices shared by the three browser purchase surfaces. */
export const COMPUTER_OFFERS: SizeOffer[] = [
  {
    size: 'standard',
    vcpus: 4,
    memoryGb: 8,
    diskGb: 100,
    quote: {
      size: 'standard',
      priceId: 'standard',
      amount: 3000,
      currency: 'usd',
      interval: 'month',
    },
    soldOut: false,
    alwaysOnSoldOut: false,
    notifyRequested: false,
  },
  {
    size: 'large',
    vcpus: 8,
    memoryGb: 16,
    diskGb: 200,
    quote: {
      size: 'large',
      priceId: 'large',
      amount: 6000,
      currency: 'usd',
      interval: 'month',
    },
    soldOut: false,
    alwaysOnSoldOut: false,
    notifyRequested: false,
  },
  {
    size: 'xl',
    vcpus: 16,
    memoryGb: 32,
    diskGb: 400,
    quote: {
      size: 'xl',
      priceId: 'xl',
      amount: 12000,
      currency: 'usd',
      interval: 'month',
    },
    soldOut: false,
    alwaysOnSoldOut: false,
    notifyRequested: false,
  },
];
