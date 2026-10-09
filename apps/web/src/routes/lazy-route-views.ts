import { lazyNamed } from '@core/util/lazyNamed';
import { lazy } from 'solid-js';

/**
 * Every view except Home (the default landing) loads as its own chunk. The
 * split router warms a route's chunks while it navigates, and `AppShell`
 * fetches the likely-next ones once the first screen settles.
 */
export const ActivityRouteView = lazyNamed(
  () => import('@app/features/activity/route-views'),
  'ActivityRouteView'
);
export const AgentsRouteView = lazyNamed(
  () => import('@app/features/agents-view/route-views'),
  'AgentsRouteView'
);
export const MobileWebSignup = lazyNamed(
  () => import('@app/features/auth/auth'),
  'MobileWebSignup'
);
export const CallDetailRouteView = lazyNamed(
  () => import('@app/features/block-call/route-views'),
  'CallDetailRouteView'
);
export const PrDetailRouteView = lazyNamed(
  () => import('@app/features/block-pr/route-views'),
  'PrDetailRouteView'
);
export const CalendarRouteView = lazyNamed(
  () => import('@app/features/calendar-view/route-views'),
  'CalendarRouteView'
);
export const ChannelInviteAcceptance = lazyNamed(
  () => import('@app/features/channel-invitations/ChannelInviteAcceptance'),
  'ChannelInviteAcceptance'
);
export const ChannelDetailRouteView = lazyNamed(
  () => import('@app/features/channels-view/channels-view'),
  'ChannelDetailRouteView'
);
export const ChannelsRouteView = lazyNamed(
  () => import('@app/features/channels-view/route-views'),
  'ChannelsRouteView'
);
export const CompaniesRouteView = lazyNamed(
  () => import('@app/features/crm/route-views'),
  'CompaniesRouteView'
);
export const DriveDetailView = lazyNamed(
  () => import('@app/features/drive-view/components/DriveDetailView'),
  'DriveDetailView'
);
export const DriveCallRouteView = lazyNamed(
  () => import('@app/features/drive-view/route-views'),
  'DriveCallRouteView'
);
export const DriveRouteView = lazyNamed(
  () => import('@app/features/drive-view/route-views'),
  'DriveRouteView'
);
export const EmailDetailRouteView = lazyNamed(
  () => import('@app/features/email-view/components/EmailDetailView'),
  'EmailDetailRouteView'
);
export const MailRouteView = lazyNamed(
  () => import('@app/features/email-view/route-views'),
  'MailRouteView'
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
export const ReviewsPrDetailRouteView = lazyNamed(
  () => import('@app/features/reviews-view/route-views'),
  'ReviewsPrDetailRouteView'
);
export const ReviewsRouteView = lazyNamed(
  () => import('@app/features/reviews-view/route-views'),
  'ReviewsRouteView'
);
export const RoutineCreateRouteView = lazyNamed(
  () => import('@app/features/routines/route-views'),
  'RoutineCreateRouteView'
);
export const SettingsRouteView = lazyNamed(
  () => import('@app/features/settings/route-views'),
  'SettingsRouteView'
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
export const TasksRouteView = lazyNamed(
  () => import('@app/features/tasks-view/route-views'),
  'TasksRouteView'
);
export const TeamInviteAcceptance = lazyNamed(
  () => import('@app/features/team-invitations/TeamInviteAcceptance'),
  'TeamInviteAcceptance'
);
export const BookingReceiptRoutePage = lazyNamed(
  () => import('./pages'),
  'BookingReceiptRoutePage'
);
export const FormRespondRoutePage = lazyNamed(
  () => import('./pages'),
  'FormRespondRoutePage'
);
export const EmailCallback = lazyNamed(
  () => import('./pages'),
  'EmailCallback'
);
export const EmailLinkCallback = lazyNamed(
  () => import('./pages'),
  'EmailLinkCallback'
);
export const LoginPage = lazyNamed(() => import('./pages'), 'LoginPage');
export const LoginPopupSuccess = lazyNamed(
  () => import('./pages'),
  'LoginPopupSuccess'
);
export const OnboardingPage = lazyNamed(
  () => import('./pages'),
  'OnboardingPage'
);
export const PublicBookingRoutePage = lazyNamed(
  () => import('./pages'),
  'PublicBookingRoutePage'
);
export const SignupPage = lazyNamed(() => import('./pages'), 'SignupPage');
export const TaskSlugPage = lazyNamed(() => import('./pages'), 'TaskSlugPage');
export const WelcomePage = lazyNamed(() => import('./pages'), 'WelcomePage');
export const NotFound = lazy(
  () => import('@core/component/AccessErrorViews/NotFound')
);

/**
 * Views a session is likely to open next. Fetching them while the browser is
 * idle keeps the first navigation as fast as it was with one big bundle.
 */
export const LIKELY_NEXT_VIEWS = [
  HomeEntityDetailRouteView,
  ChannelsRouteView,
  ChannelDetailRouteView,
  MailRouteView,
  EmailDetailRouteView,
  DriveRouteView,
  DriveDetailView,
  TasksRouteView,
  AgentsRouteView,
  CalendarRouteView,
];
