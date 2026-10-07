import { lazyNamed } from '@core/util/lazyNamed';
import { lazy } from 'solid-js';

/**
 * Shared lazy route view components. Import these anywhere a view is rendered
 * so preloading warms the same lazy instances the sidebar and router use.
 */
export const ActivityRouteView = lazyNamed(
  () => import('@app/features/activity/route-views'),
  'ActivityRouteView'
);
export const AgentsRouteView = lazyNamed(
  () => import('@app/features/agents-view/route-views'),
  'AgentsRouteView'
);
export const CalendarRouteView = lazyNamed(
  () => import('@app/features/calendar-view/route-views'),
  'CalendarRouteView'
);
export const ChannelsRouteView = lazyNamed(
  () => import('@app/features/channels-view/route-views'),
  'ChannelsRouteView'
);
export const CompaniesRouteView = lazyNamed(
  () => import('@app/features/crm/route-views'),
  'CompaniesRouteView'
);
export const DriveRouteView = lazyNamed(
  () => import('@app/features/drive-view/route-views'),
  'DriveRouteView'
);
export const EmailCompose = lazyNamed(
  () => import('@app/features/email-compose/email-compose'),
  'EmailCompose'
);
export const MailRouteView = lazyNamed(
  () => import('@app/features/email-view/route-views'),
  'MailRouteView'
);
export const CallsRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'CallsRouteView'
);
export const FoldersRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'FoldersRouteView'
);
export const RecentRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'RecentRouteView'
);
export const SearchRouteView = lazyNamed(
  () => import('@app/features/next-soup/route-views'),
  'SearchRouteView'
);
export const CreateProjectView = lazyNamed(
  () => import('@app/features/projects/project-view'),
  'CreateProjectView'
);
export const ProjectsListView = lazyNamed(
  () => import('@app/features/projects/project-view'),
  'ProjectsListView'
);
export const ProjectView = lazyNamed(
  () => import('@app/features/projects/project-view'),
  'ProjectView'
);
export const ReviewsRouteView = lazyNamed(
  () => import('@app/features/reviews-view/route-views'),
  'ReviewsRouteView'
);
export const RoutineCreator = lazyNamed(
  () => import('@app/features/routines/routine-creator'),
  'RoutineCreator'
);
export const SettingsRouteView = lazyNamed(
  () => import('@app/features/settings/route-views'),
  'SettingsRouteView'
);
export const TasksRouteView = lazyNamed(
  () => import('@app/features/tasks-view/route-views'),
  'TasksRouteView'
);
export const EventComposerSplit = lazyNamed(
  () => import('@block-calendar/components/EventComposerSplit'),
  'EventComposerSplit'
);
export const ChannelCompose = lazyNamed(
  () => import('@block-channel/component/Compose'),
  'ChannelCompose'
);
export const ComposeSkill = lazyNamed(
  () => import('@block-md/component/ComposeSkill'),
  'ComposeSkill'
);
export const ComposeTask = lazyNamed(
  () => import('@block-md/component/ComposeTask'),
  'ComposeTask'
);
export const ComposeDocument = lazyNamed(
  () => import('@block-md/views/compose-document'),
  'ComposeDocument'
);
export const NotFound = lazy(
  () => import('@core/component/AccessErrorViews/NotFound')
);

// Route-specific views used by app-router-view.tsx but not componentRegistry.tsx
export const CallDetailRouteView = lazyNamed(
  () => import('@app/features/block-call/route-views'),
  'CallDetailRouteView'
);
export const PrDetailRouteView = lazyNamed(
  () => import('@app/features/block-pr/route-views'),
  'PrDetailRouteView'
);
export const ChannelInviteAcceptance = lazyNamed(
  () => import('@app/features/channel-invitations/ChannelInviteAcceptance'),
  'ChannelInviteAcceptance'
);
export const ChannelDetailRouteView = lazyNamed(
  () => import('@app/features/channels-view/channels-view'),
  'ChannelDetailRouteView'
);
export const DriveDetailView = lazyNamed(
  () => import('@app/features/drive-view/components/DriveDetailView'),
  'DriveDetailView'
);
export const DriveCallRouteView = lazyNamed(
  () => import('@app/features/drive-view/route-views'),
  'DriveCallRouteView'
);
export const EmailDetailRouteView = lazyNamed(
  () => import('@app/features/email-view/components/EmailDetailView'),
  'EmailDetailRouteView'
);
export const InviteLinksPortal = lazyNamed(
  () => import('@app/features/gtm-invite/InviteLinksPortal'),
  'InviteLinksPortal'
);
export const InviteWelcome = lazyNamed(
  () => import('@app/features/gtm-invite/InviteWelcome'),
  'InviteWelcome'
);
export const HomeEntityDetailRouteView = lazyNamed(
  () => import('@app/features/home/components/HomeEntityDetailRouteView'),
  'HomeEntityDetailRouteView'
);
export const MeetingRouter = lazyNamed(
  () => import('@app/features/meetings/meeting-router'),
  'MeetingRouter'
);
export const ReviewsPrDetailRouteView = lazyNamed(
  () => import('@app/features/reviews-view/route-views'),
  'ReviewsPrDetailRouteView'
);
export const RoutineCreateRouteView = lazyNamed(
  () => import('@app/features/routines/route-views'),
  'RoutineCreateRouteView'
);
export const TasksDetailRouteView = lazyNamed(
  () => import('@app/features/tasks-view/components/TasksDetailView'),
  'TasksDetailRouteView'
);
export const ProjectDetailRouteView = lazyNamed(
  () => import('@app/features/tasks-view/route-views'),
  'ProjectDetailRouteView'
);
export const ProjectTaskRouteView = lazyNamed(
  () => import('@app/features/tasks-view/route-views'),
  'ProjectTaskRouteView'
);
export const TeamInviteAcceptance = lazyNamed(
  () => import('@app/features/team-invitations/TeamInviteAcceptance'),
  'TeamInviteAcceptance'
);
export const BookingReceiptRoutePage = lazyNamed(
  () => import('@app/routes/pages'),
  'BookingReceiptRoutePage'
);
export const FormRespondRoutePage = lazyNamed(
  () => import('@app/routes/pages'),
  'FormRespondRoutePage'
);
export const EmailCallback = lazyNamed(
  () => import('@app/routes/pages'),
  'EmailCallback'
);
export const EmailLinkCallback = lazyNamed(
  () => import('@app/routes/pages'),
  'EmailLinkCallback'
);
export const LoginPage = lazyNamed(
  () => import('@app/routes/pages'),
  'LoginPage'
);
export const LoginPopupSuccess = lazyNamed(
  () => import('@app/routes/pages'),
  'LoginPopupSuccess'
);
export const OnboardingPage = lazyNamed(
  () => import('@app/routes/pages'),
  'OnboardingPage'
);
export const PublicBookingRoutePage = lazyNamed(
  () => import('@app/routes/pages'),
  'PublicBookingRoutePage'
);
export const SignupPage = lazyNamed(
  () => import('@app/routes/pages'),
  'SignupPage'
);
export const TaskSlugPage = lazyNamed(
  () => import('@app/routes/pages'),
  'TaskSlugPage'
);
export const WelcomePage = lazyNamed(
  () => import('@app/routes/pages'),
  'WelcomePage'
);
export const MobileWebSignup = lazyNamed(
  () => import('@app/features/auth/auth'),
  'MobileWebSignup'
);
