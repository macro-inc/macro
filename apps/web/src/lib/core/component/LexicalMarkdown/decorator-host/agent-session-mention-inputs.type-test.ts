import type { AgentSessionMentionDecoratorProps } from '@macro-inc/lexical-core';
import type { AgentSessionMentionUIProps } from '../component/decorator/AgentSessionMention';

type Assert<T extends true> = T;

export type AgentSessionUiIdRemainsText = Assert<
  AgentSessionMentionUIProps['id'] extends string ? true : false
>;
export type AgentSessionUiKeepsNullLabel = Assert<
  null extends AgentSessionMentionUIProps['label'] ? true : false
>;
export type AgentSessionUiKeepsNullMentionId = Assert<
  null extends AgentSessionMentionUIProps['mentionUuid'] ? true : false
>;
export type AgentSessionUiExpandedRemainsFlag = Assert<
  null extends AgentSessionMentionUIProps['expanded'] ? false : true
>;
export type PublicAgentSessionIdRemainsExact = Assert<
  null extends AgentSessionMentionDecoratorProps['id'] ? false : true
>;
export type PublicAgentSessionLabelRemainsExact = Assert<
  null extends AgentSessionMentionDecoratorProps['label'] ? false : true
>;
export type PublicAgentSessionMentionIdRemainsExact = Assert<
  null extends AgentSessionMentionDecoratorProps['mentionUuid'] ? false : true
>;
export type SourceInfoStillFitsUiProps = Assert<
  AgentSessionMentionDecoratorProps extends AgentSessionMentionUIProps
    ? true
    : false
>;
