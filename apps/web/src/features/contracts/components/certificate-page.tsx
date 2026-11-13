import { t } from '@app/lib/i18n';
import MacroLogo from '@icon/macro-logo.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { For, type JSX, Show } from 'solid-js';
import type {
  Certificate,
  CertificateHash,
  CertificateSigner,
} from '../core/certificate';
import { describeEvent } from './activity';
import { formatUtc } from './format';
import { SignatureMark } from './signature-mark';

function Term(props: { label: string; children: JSX.Element; wide?: boolean }) {
  return (
    <>
      <dt class="text-[#595959]">{props.label}</dt>
      <dd class="m-0 min-w-0" classList={{ 'col-span-3': props.wide }}>
        {props.children}
      </dd>
    </>
  );
}

function hashStep(hash: CertificateHash): string {
  if (hash.step === 'before_signing') return t('contracts.hashBeforeSigning');
  if (hash.final) {
    return t('contracts.hashFinal', { name: hash.signerName });
  }
  return t('contracts.hashAfterSigner', { name: hash.signerName });
}

function SignerCard(props: { signer: CertificateSigner }) {
  const missing = () => t('contracts.certificateNotRecorded');
  return (
    <div class="flex flex-col gap-2 rounded-[10px] border border-[#d4d4d4] px-4 py-3.5">
      <div class="flex min-h-12 items-end justify-between gap-2.5 border-b border-[#e4e4e4] pb-2">
        <div class="flex min-w-0 flex-col">
          <span class="truncate text-sm font-semibold">
            {props.signer.name}
          </span>
          <span class="text-[#595959]">
            {t('contracts.certificateSignerPosition', {
              position: props.signer.position,
              total: props.signer.signerCount,
            })}
          </span>
        </div>
        <Show when={props.signer.signedAt ? props.signer.signature : undefined}>
          {(signature) => (
            <div class="h-9 w-40 shrink-0">
              <SignatureMark
                mark={signature()}
                label={t('contracts.signatureOf', { name: props.signer.name })}
              />
            </div>
          )}
        </Show>
      </div>
      <dl class="m-0 grid grid-cols-[5.75rem_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-[11px] leading-[17px]">
        <dt class="text-[#595959]">{t('contracts.certificateEmail')}</dt>
        <dd class="m-0 truncate">{props.signer.email}</dd>
        <dt class="text-[#595959]">{t('contracts.certificateVerification')}</dt>
        <dd class="m-0">{t('contracts.certificateEmailLink')}</dd>
        <dt class="text-[#595959]">{t('contracts.certificateTokenId')}</dt>
        <dd class="m-0 truncate font-mono text-[10.5px]">
          {props.signer.tokenId ?? missing()}
        </dd>
        <dt class="text-[#595959]">{t('contracts.certificateIp')}</dt>
        <dd class="m-0">{missing()}</dd>
        <dt class="text-[#595959]">{t('contracts.certificateUserAgent')}</dt>
        <dd class="m-0 truncate">{props.signer.userAgent ?? missing()}</dd>
        <dt class="text-[#595959]">{t('contracts.certificateDisclosure')}</dt>
        <dd class="m-0 tabular-nums">
          {props.signer.disclosureAcceptedAt
            ? formatUtc(props.signer.disclosureAcceptedAt)
            : missing()}
        </dd>
        <dt class="text-[#595959]">{t('contracts.certificateSigned')}</dt>
        <dd class="m-0 font-semibold tabular-nums">
          {props.signer.signedAt ? formatUtc(props.signer.signedAt) : missing()}
        </dd>
      </dl>
    </div>
  );
}

/**
 * The Certificate of Completion as it is appended to the executed PDF: a
 * white Letter page in every theme, so it prints as shown.
 */
export function CertificatePage(props: { certificate: Certificate }) {
  const certificate = () => props.certificate;

  return (
    <article
      aria-label={t('contracts.certificateTitle')}
      class="flex min-h-[1056px] w-[816px] max-w-full flex-col gap-5 bg-[#ffffff] px-14 pt-13 pb-10 text-xs leading-[18px] text-[#141414]"
    >
      <header class="flex items-start gap-3.5 border-b-2 border-[#141414] pb-4">
        <MacroLogo class="mt-0.5 size-7 shrink-0" />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 class="m-0 text-[22px] leading-7 font-semibold tracking-tight">
            {t('contracts.certificateTitle')}
          </h1>
          <span class="text-[#595959]">
            {certificate().completedAt
              ? t('contracts.certificateSubtitle', {
                  title: certificate().title,
                })
              : t('contracts.certificateSubtitlePending', {
                  title: certificate().title,
                })}
          </span>
        </div>
        <Show when={certificate().completedAt}>
          <span class="inline-flex h-6 items-center gap-1.5 rounded-full border border-[#141414] px-2.5 font-semibold">
            <CheckIcon class="size-3" />
            {t('contracts.certificateCompleted')}
          </span>
        </Show>
      </header>

      <dl class="m-0 grid grid-cols-[7.5rem_minmax(0,1fr)_6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <Term label={t('contracts.certificateEnvelope')}>
          <span class="font-mono text-[11px] break-all">
            {certificate().envelopeId}
          </span>
        </Term>
        <Term label={t('contracts.certificateSender')}>
          {certificate().sender}
        </Term>
        <Term label={t('contracts.certificateCreated')}>
          <span class="tabular-nums">{formatUtc(certificate().createdAt)}</span>
        </Term>
        <Term label={t('contracts.certificateCompletedAt')}>
          <span class="tabular-nums">
            {certificate().completedAt
              ? formatUtc(certificate().completedAt ?? '')
              : t('contracts.certificateNotCompleted')}
          </span>
        </Term>
        <Term label={t('contracts.documents')} wide>
          {certificate()
            .documents.map((document) =>
              t('contracts.certificateDocument', {
                name: document.name,
                count: document.pageCount,
              })
            )
            .join(', ')}
        </Term>
        <Term label={t('contracts.certificateRouting')} wide>
          {certificate().signingOrder === 'sequential'
            ? t('contracts.certificateSequential')
            : t('contracts.certificateParallel')}
          <Show when={certificate().copyRecipients.length > 0}>
            {' '}
            {t('contracts.certificateCopies', {
              names: certificate().copyRecipients.join(', '),
            })}
          </Show>
        </Term>
      </dl>

      <section class="flex flex-col gap-2.5">
        <h2 class="m-0 text-[11px] font-semibold tracking-[0.08em] text-[#595959] uppercase">
          {t('contracts.certificateSigners')}
        </h2>
        <div class="grid grid-cols-2 gap-4">
          <For each={certificate().signers}>
            {(signer) => <SignerCard signer={signer} />}
          </For>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h2 class="m-0 text-[11px] font-semibold tracking-[0.08em] text-[#595959] uppercase">
          {t('contracts.certificateHashes')}
        </h2>
        <For each={certificate().hashes}>
          {(hash) => (
            <div class="grid grid-cols-[10.5rem_minmax(0,1fr)] items-baseline gap-3">
              <span>{hashStep(hash)}</span>
              <span class="font-mono text-[10.5px] break-all">{hash.hash}</span>
            </div>
          )}
        </For>
      </section>

      <section class="flex flex-col gap-1.5">
        <h2 class="m-0 mb-0.5 text-[11px] font-semibold tracking-[0.08em] text-[#595959] uppercase">
          {t('contracts.certificateEventLog')}
        </h2>
        <For each={certificate().events}>
          {(event) => (
            <div class="grid grid-cols-[10.5rem_12rem_minmax(0,1fr)] gap-3 border-b border-[#ececec] pb-1 text-[11.5px] leading-[17px]">
              <span class="tabular-nums">{formatUtc(event.at)}</span>
              <span class="truncate font-mono text-[10.5px]">{event.type}</span>
              <span class="text-[#3d3d3d]">{describeEvent(event)}</span>
            </div>
          )}
        </For>
      </section>

      <div class="flex-1" />
      <footer class="text-[10.5px] leading-[15px] text-[#595959]">
        <p class="m-0 max-w-[35rem]">{t('contracts.certificateFooter')}</p>
      </footer>
    </article>
  );
}
