import { t } from '@app/lib/i18n';
import { match } from 'ts-pattern';
import type { NotificationSoundCategoryId } from '../core/categories';
import type { CallSoundId, NotificationSoundId } from '../core/sounds';

export const soundCategoryLabel = (id: NotificationSoundCategoryId) =>
  match(id)
    .with('messages', () => t('notificationSounds.categoryMessages'))
    .with('mentions', () => t('notificationSounds.categoryMentions'))
    .with('replies', () => t('notificationSounds.categoryReplies'))
    .with('email', () => t('notificationSounds.categoryEmail'))
    .with('meetings', () => t('notificationSounds.categoryMeetings'))
    .with('tasks', () => t('notificationSounds.categoryTasks'))
    .with('agents', () => t('notificationSounds.categoryAgents'))
    .with('other', () => t('notificationSounds.categoryOther'))
    .exhaustive();

export const soundCategoryDescription = (id: NotificationSoundCategoryId) =>
  match(id)
    .with('messages', () => t('notificationSounds.categoryMessagesDescription'))
    .with('mentions', () => t('notificationSounds.categoryMentionsDescription'))
    .with('replies', () => t('notificationSounds.categoryRepliesDescription'))
    .with('email', () => t('notificationSounds.categoryEmailDescription'))
    .with('meetings', () => t('notificationSounds.categoryMeetingsDescription'))
    .with('tasks', () => t('notificationSounds.categoryTasksDescription'))
    .with('agents', () => t('notificationSounds.categoryAgentsDescription'))
    .with('other', () => t('notificationSounds.categoryOtherDescription'))
    .exhaustive();

export const soundLabel = (id: NotificationSoundId | CallSoundId) =>
  match(id)
    .with('ding', () => t('notificationSounds.soundDing'))
    .with('chime', () => t('notificationSounds.soundChime'))
    .with('pop', () => t('notificationSounds.soundPop'))
    .with('knock', () => t('notificationSounds.soundKnock'))
    .with('pluck', () => t('notificationSounds.soundPluck'))
    .with('ping', () => t('notificationSounds.soundPing'))
    .with('bloom', () => t('notificationSounds.soundBloom'))
    .with('call-join', () => t('notificationSounds.soundCallJoin'))
    .with('call-leave', () => t('notificationSounds.soundCallLeave'))
    .exhaustive();
