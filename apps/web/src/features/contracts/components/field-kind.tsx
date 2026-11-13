import { t } from '@app/lib/i18n';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import EnvelopeIcon from '@icon/system/regular/envelope-simple.svg';
import SignatureIcon from '@icon/system/regular/signature.svg';
import TextAaIcon from '@icon/system/regular/text-aa.svg';
import TextIcon from '@icon/system/regular/text-t.svg';
import UserIcon from '@icon/system/regular/user.svg';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { FieldKind } from '../core/packet';

export function fieldKindLabel(kind: FieldKind): string {
  return match(kind)
    .with('signature', () => t('contracts.fieldSignature'))
    .with('initials', () => t('contracts.fieldInitials'))
    .with('date_signed', () => t('contracts.fieldDateSigned'))
    .with('full_name', () => t('contracts.fieldFullName'))
    .with('email', () => t('contracts.fieldEmail'))
    .with('text', () => t('contracts.fieldText'))
    .with('checkbox', () => t('contracts.fieldCheckbox'))
    .exhaustive();
}

function fieldKindIcon(kind: FieldKind): Component<{ class?: string }> {
  return match(kind)
    .with('signature', () => SignatureIcon)
    .with('initials', () => TextAaIcon)
    .with('date_signed', () => CalendarIcon)
    .with('full_name', () => UserIcon)
    .with('email', () => EnvelopeIcon)
    .with('text', () => TextIcon)
    .with('checkbox', () => CheckSquareIcon)
    .exhaustive();
}

export function FieldKindIcon(props: { kind: FieldKind; class?: string }) {
  return <Dynamic component={fieldKindIcon(props.kind)} class={props.class} />;
}
