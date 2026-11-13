import { t } from '@app/lib/i18n';
import type { Certificate, CertificateHash } from '../core/certificate';
import type { CertificateSheet } from '../core/certificate-sheet';
import { describeEvent } from './activity';
import { formatUtc } from './format';

function hashStep(hash: CertificateHash): string {
  if (hash.step === 'before_signing') return t('contracts.hashBeforeSigning');
  if (hash.final) return t('contracts.hashFinal', { name: hash.signerName });
  return t('contracts.hashAfterSigner', { name: hash.signerName });
}

/**
 * The certificate in the reader's language, as the words to print. The
 * on-screen certificate and the page appended to the downloaded PDF say the
 * same thing; this is what the PDF prints.
 */
export function certificateSheet(certificate: Certificate): CertificateSheet {
  const missing = t('contracts.certificateNotRecorded');
  const routing =
    certificate.signingOrder === 'sequential'
      ? t('contracts.certificateSequential')
      : t('contracts.certificateParallel');
  const copies =
    certificate.copyRecipients.length > 0
      ? t('contracts.certificateCopies', {
          names: certificate.copyRecipients.join(', '),
        })
      : '';

  return {
    title: t('contracts.certificateTitle'),
    subtitle: certificate.completedAt
      ? t('contracts.certificateSubtitle', { title: certificate.title })
      : t('contracts.certificateSubtitlePending', { title: certificate.title }),
    completed: certificate.completedAt
      ? t('contracts.certificateCompleted')
      : undefined,
    facts: [
      {
        label: t('contracts.certificateEnvelope'),
        value: certificate.envelopeId,
      },
      { label: t('contracts.certificateSender'), value: certificate.sender },
      {
        label: t('contracts.certificateCreated'),
        value: formatUtc(certificate.createdAt),
      },
      {
        label: t('contracts.certificateCompletedAt'),
        value: certificate.completedAt
          ? formatUtc(certificate.completedAt)
          : t('contracts.certificateNotCompleted'),
      },
    ],
    wideFacts: [
      {
        label: t('contracts.documents'),
        value: certificate.documents
          .map((document) =>
            t('contracts.certificateDocument', {
              name: document.name,
              count: document.pageCount,
            })
          )
          .join(', '),
      },
      {
        label: t('contracts.certificateRouting'),
        value: [routing, copies].filter(Boolean).join(' '),
      },
    ],
    signersHeading: t('contracts.certificateSigners'),
    signers: certificate.signers.map((signer) => ({
      name: signer.name,
      position: t('contracts.certificateSignerPosition', {
        position: signer.position,
        total: signer.signerCount,
      }),
      signature: signer.signedAt ? signer.signature : undefined,
      facts: [
        { label: t('contracts.certificateEmail'), value: signer.email },
        {
          label: t('contracts.certificateVerification'),
          value: t('contracts.certificateEmailLink'),
        },
        {
          label: t('contracts.certificateTokenId'),
          value: signer.tokenId ?? missing,
        },
        { label: t('contracts.certificateIp'), value: missing },
        {
          label: t('contracts.certificateUserAgent'),
          value: signer.userAgent ?? missing,
        },
        {
          label: t('contracts.certificateDisclosure'),
          value: signer.disclosureAcceptedAt
            ? formatUtc(signer.disclosureAcceptedAt)
            : missing,
        },
        {
          label: t('contracts.certificateSigned'),
          value: signer.signedAt ? formatUtc(signer.signedAt) : missing,
        },
      ],
    })),
    hashesHeading: t('contracts.certificateHashes'),
    hashes: certificate.hashes.map((hash) => ({
      label: hashStep(hash),
      value: hash.hash,
    })),
    eventsHeading: t('contracts.certificateEventLog'),
    events: certificate.events.map((event) => ({
      at: formatUtc(event.at),
      type: event.type,
      text: describeEvent(event),
    })),
    footer: t('contracts.certificateFooter'),
  };
}
