# Meeting session ownership

`MeetingSessionProvider` owns the shared cleanup lifecycle and disposable Solid roots for standalone sessions. A route attaches to a session by share token. On dismissal, an in-flight join is cancelled and late credentials are released; a connected session stays in the provider and can be reattached by opening the same link. The provider disposes all session roots on unmount, and an external call disconnection disposes a detached session. Explicit Leave still releases the participant, disconnects the call, and navigates to the call exit destination. Back navigates to `/app` without leaving the call.

Session ownership emits `meeting.session.acquire`, `meeting.session.detach`, and `meeting.session.dispose` spans. These record creation, reuse, retention, and disposal outcomes with the call ID when available, never the share token.
