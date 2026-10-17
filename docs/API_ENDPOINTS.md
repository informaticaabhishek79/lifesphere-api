# LifeSphere API — endpoint inventory

Generated from the OpenAPI document. 313 operations across 233 paths. All paths are under `/v1`; interactive docs at `/docs`, spec at `/docs/openapi.json`.

| Area | Operations |
|---|---|
| admin | 53 |
| assistant | 6 |
| attachments | 5 |
| auth | 17 |
| budget | 4 |
| calendar | 9 |
| check-ins | 10 |
| civic | 6 |
| community | 38 |
| consumer | 22 |
| contacts | 10 |
| directory | 3 |
| health | 2 |
| help | 9 |
| home-inventory | 10 |
| households | 17 |
| knowledge | 3 |
| me | 6 |
| notifications | 10 |
| privacy | 11 |
| provider-portal | 15 |
| reminders | 5 |
| service-requests | 6 |
| services | 4 |
| sharing | 5 |
| shopping-lists | 9 |
| tasks | 18 |

## admin

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/admin/assistant/eval-cases` |  |
| POST | `/v1/admin/assistant/eval-cases` |  |
| DELETE | `/v1/admin/assistant/eval-cases/{id}` |  |
| POST | `/v1/admin/assistant/eval-runs` |  |
| GET | `/v1/admin/assistant/eval-runs` |  |
| GET | `/v1/admin/assistant/feedback-summary` |  |
| GET | `/v1/admin/audit` |  |
| GET | `/v1/admin/config` |  |
| PUT | `/v1/admin/config/{key}` |  |
| GET | `/v1/admin/knowledge/articles` |  |
| POST | `/v1/admin/knowledge/articles` |  |
| PATCH | `/v1/admin/knowledge/articles/{id}` |  |
| DELETE | `/v1/admin/knowledge/articles/{id}` |  |
| GET | `/v1/admin/knowledge/articles/{slug}` |  |
| GET | `/v1/admin/knowledge/articles/review-due` |  |
| GET | `/v1/admin/knowledge/sources` |  |
| POST | `/v1/admin/knowledge/sources` |  |
| PATCH | `/v1/admin/knowledge/sources/{id}` |  |
| POST | `/v1/admin/localities` |  |
| PATCH | `/v1/admin/localities/{id}` |  |
| GET | `/v1/admin/me` |  |
| POST | `/v1/admin/moderation/actions` |  |
| GET | `/v1/admin/moderation/actions` |  |
| GET | `/v1/admin/moderation/appeals` |  |
| POST | `/v1/admin/moderation/appeals/{id}/decide` |  |
| GET | `/v1/admin/moderation/reports` |  |
| GET | `/v1/admin/moderation/reports/{id}` |  |
| POST | `/v1/admin/moderation/reports/{id}/assign` |  |
| POST | `/v1/admin/moderation/sanctions/{id}/lift` |  |
| GET | `/v1/admin/notifications/failures` |  |
| GET | `/v1/admin/official-channels` |  |
| POST | `/v1/admin/official-channels` |  |
| PATCH | `/v1/admin/official-channels/{id}` |  |
| GET | `/v1/admin/overview` |  |
| GET | `/v1/admin/plans` |  |
| PUT | `/v1/admin/plans` |  |
| GET | `/v1/admin/privacy-requests` |  |
| POST | `/v1/admin/privacy-requests/{id}/action` |  |
| GET | `/v1/admin/providers` |  |
| GET | `/v1/admin/providers/{id}` |  |
| POST | `/v1/admin/providers/{id}/decision` |  |
| PUT | `/v1/admin/providers/{id}/sponsorship` |  |
| POST | `/v1/admin/providers/{id}/verification` |  |
| POST | `/v1/admin/service-categories` |  |
| PATCH | `/v1/admin/service-categories/{id}` |  |
| GET | `/v1/admin/staff` |  |
| POST | `/v1/admin/staff` |  |
| DELETE | `/v1/admin/staff/{id}` |  |
| POST | `/v1/admin/subscriptions` |  |
| GET | `/v1/admin/users` |  |
| POST | `/v1/admin/users/{id}/disable` |  |
| POST | `/v1/admin/users/{id}/enable` |  |
| POST | `/v1/admin/users/{id}/revoke-sessions` |  |

## assistant

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/assistant/ask` |  |
| GET | `/v1/assistant/conversations` |  |
| DELETE | `/v1/assistant/conversations` |  |
| GET | `/v1/assistant/conversations/{id}` |  |
| DELETE | `/v1/assistant/conversations/{id}` |  |
| POST | `/v1/assistant/feedback` |  |

## attachments

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/attachments` |  |
| GET | `/v1/attachments/{id}` |  |
| DELETE | `/v1/attachments/{id}` |  |
| GET | `/v1/attachments/{id}/content` |  |
| POST | `/v1/attachments/{id}/keep` |  |

## auth

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/auth/contact/request` |  |
| POST | `/v1/auth/contact/verify` |  |
| POST | `/v1/auth/logout` |  |
| POST | `/v1/auth/logout-all` |  |
| GET | `/v1/auth/mfa` |  |
| POST | `/v1/auth/mfa/recovery-codes` |  |
| POST | `/v1/auth/mfa/totp/confirm` |  |
| POST | `/v1/auth/mfa/totp/disable` |  |
| POST | `/v1/auth/mfa/totp/setup` |  |
| POST | `/v1/auth/mfa/verify` |  |
| POST | `/v1/auth/otp/request` |  |
| POST | `/v1/auth/otp/verify` |  |
| POST | `/v1/auth/reauth/request` |  |
| POST | `/v1/auth/reauth/verify` |  |
| POST | `/v1/auth/refresh` |  |
| GET | `/v1/auth/sessions` |  |
| DELETE | `/v1/auth/sessions/{id}` |  |

## budget

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/budgets` |  |
| POST | `/v1/budgets` |  |
| PATCH | `/v1/budgets/{id}` |  |
| DELETE | `/v1/budgets/{id}` |  |

## calendar

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/calendar/events` |  |
| POST | `/v1/calendar/events` |  |
| GET | `/v1/calendar/events/{id}` |  |
| PATCH | `/v1/calendar/events/{id}` |  |
| DELETE | `/v1/calendar/events/{id}` |  |
| POST | `/v1/calendar/events/{id}/attendees` |  |
| DELETE | `/v1/calendar/events/{id}/attendees/{userId}` |  |
| POST | `/v1/calendar/events/{id}/cancel` |  |
| POST | `/v1/calendar/events/{id}/rsvp` |  |

## check-ins

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/check-ins/events` |  |
| GET | `/v1/check-ins/events/{id}` |  |
| POST | `/v1/check-ins/events/{id}/acknowledge` |  |
| POST | `/v1/check-ins/events/{id}/complete` |  |
| POST | `/v1/check-ins/now` |  |
| GET | `/v1/check-ins/people` |  |
| GET | `/v1/check-ins/schedules` |  |
| POST | `/v1/check-ins/schedules` |  |
| PATCH | `/v1/check-ins/schedules/{id}` |  |
| DELETE | `/v1/check-ins/schedules/{id}` |  |

## civic

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/civic-issues` |  |
| POST | `/v1/civic-issues` |  |
| GET | `/v1/civic-issues/{id}` |  |
| PATCH | `/v1/civic-issues/{id}` |  |
| DELETE | `/v1/civic-issues/{id}` |  |
| POST | `/v1/civic-issues/{id}/share` |  |

## community

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/community/blocks` |  |
| PUT | `/v1/community/blocks/{userId}` |  |
| DELETE | `/v1/community/blocks/{userId}` |  |
| GET | `/v1/community/bookmarks` |  |
| PATCH | `/v1/community/comments/{id}` |  |
| DELETE | `/v1/community/comments/{id}` |  |
| GET | `/v1/community/feed` |  |
| GET | `/v1/community/groups` |  |
| POST | `/v1/community/groups` |  |
| GET | `/v1/community/groups/{id}` |  |
| PATCH | `/v1/community/groups/{id}` |  |
| DELETE | `/v1/community/groups/{id}` |  |
| POST | `/v1/community/groups/{id}/invitations` |  |
| POST | `/v1/community/groups/{id}/join` |  |
| POST | `/v1/community/groups/{id}/leave` |  |
| GET | `/v1/community/groups/{id}/members` |  |
| PATCH | `/v1/community/groups/{id}/members/{userId}` |  |
| DELETE | `/v1/community/groups/{id}/members/{userId}` |  |
| GET | `/v1/community/groups/{id}/posts` |  |
| POST | `/v1/community/groups/{id}/posts` |  |
| GET | `/v1/community/groups/invitations` |  |
| POST | `/v1/community/groups/invitations/{invitationId}/respond` |  |
| GET | `/v1/community/moderation-decisions` |  |
| POST | `/v1/community/moderation-decisions/{id}/appeal` |  |
| GET | `/v1/community/posts/{id}` |  |
| PATCH | `/v1/community/posts/{id}` |  |
| DELETE | `/v1/community/posts/{id}` |  |
| PUT | `/v1/community/posts/{id}/bookmark` |  |
| DELETE | `/v1/community/posts/{id}/bookmark` |  |
| GET | `/v1/community/posts/{id}/comments` |  |
| POST | `/v1/community/posts/{id}/comments` |  |
| POST | `/v1/community/posts/{id}/moderate` |  |
| POST | `/v1/community/posts/{id}/pin` |  |
| PUT | `/v1/community/posts/{id}/reaction` |  |
| DELETE | `/v1/community/posts/{id}/reaction` |  |
| GET | `/v1/community/posts/{id}/reactions` |  |
| POST | `/v1/community/reports` |  |
| GET | `/v1/community/reports` |  |

## consumer

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/consumer/cases` |  |
| POST | `/v1/consumer/cases` |  |
| GET | `/v1/consumer/cases/{id}` |  |
| PATCH | `/v1/consumer/cases/{id}` |  |
| DELETE | `/v1/consumer/cases/{id}` |  |
| POST | `/v1/consumer/cases/{id}/attachments` |  |
| DELETE | `/v1/consumer/cases/{id}/attachments/{attachmentId}` |  |
| POST | `/v1/consumer/cases/{id}/drafts` |  |
| PATCH | `/v1/consumer/cases/{id}/drafts/{draftId}` |  |
| DELETE | `/v1/consumer/cases/{id}/drafts/{draftId}` |  |
| POST | `/v1/consumer/cases/{id}/drafts/{draftId}/approve` |  |
| POST | `/v1/consumer/cases/{id}/drafts/generate` |  |
| POST | `/v1/consumer/cases/{id}/status` |  |
| POST | `/v1/consumer/cases/{id}/timeline` |  |
| DELETE | `/v1/consumer/cases/{id}/timeline/{eventId}` |  |
| GET | `/v1/consumer/evidence-checklist` |  |
| GET | `/v1/consumer/official-channels` |  |
| GET | `/v1/consumer/purchases` |  |
| POST | `/v1/consumer/purchases` |  |
| GET | `/v1/consumer/purchases/{id}` |  |
| PATCH | `/v1/consumer/purchases/{id}` |  |
| DELETE | `/v1/consumer/purchases/{id}` |  |

## contacts

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/contacts` |  |
| PATCH | `/v1/contacts/{contactUserId}` |  |
| DELETE | `/v1/contacts/{contactUserId}` |  |
| POST | `/v1/contacts/invitations` |  |
| GET | `/v1/contacts/invitations` |  |
| DELETE | `/v1/contacts/invitations/{id}` |  |
| POST | `/v1/contacts/invitations/{id}/respond` |  |
| POST | `/v1/contacts/invitations/accept` |  |
| GET | `/v1/contacts/invitations/incoming` |  |
| POST | `/v1/contacts/invitations/preview` |  |

## directory

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/countries` |  |
| GET | `/v1/localities` |  |
| GET | `/v1/users/{id}/card` |  |

## health

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/health/live` |  |
| GET | `/v1/health/ready` |  |

## help

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/help/preferences` |  |
| PUT | `/v1/help/preferences` |  |
| POST | `/v1/help/requests` |  |
| GET | `/v1/help/requests` |  |
| GET | `/v1/help/requests/{id}` |  |
| POST | `/v1/help/requests/{id}/acknowledge` |  |
| POST | `/v1/help/requests/{id}/cancel` |  |
| POST | `/v1/help/requests/{id}/resolve` |  |
| GET | `/v1/help/requests/incoming` |  |

## home-inventory

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/inventory` |  |
| POST | `/v1/inventory` |  |
| GET | `/v1/inventory/{id}` |  |
| PATCH | `/v1/inventory/{id}` |  |
| DELETE | `/v1/inventory/{id}` |  |
| POST | `/v1/inventory/{id}/records` |  |
| DELETE | `/v1/inventory/{id}/records/{recordId}` |  |
| POST | `/v1/inventory/{id}/schedules` |  |
| PATCH | `/v1/inventory/{id}/schedules/{scheduleId}` |  |
| DELETE | `/v1/inventory/{id}/schedules/{scheduleId}` |  |

## households

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/households` |  |
| GET | `/v1/households` |  |
| GET | `/v1/households/{id}` |  |
| PATCH | `/v1/households/{id}` |  |
| DELETE | `/v1/households/{id}` |  |
| GET | `/v1/households/{id}/announcements` |  |
| POST | `/v1/households/{id}/announcements` |  |
| PATCH | `/v1/households/{id}/announcements/{announcementId}` |  |
| DELETE | `/v1/households/{id}/announcements/{announcementId}` |  |
| POST | `/v1/households/{id}/invitations` |  |
| GET | `/v1/households/{id}/invitations` |  |
| DELETE | `/v1/households/{id}/invitations/{invitationId}` |  |
| PATCH | `/v1/households/{id}/members/{userId}` |  |
| DELETE | `/v1/households/{id}/members/{userId}` |  |
| POST | `/v1/households/invitations/{invitationId}/respond` |  |
| POST | `/v1/households/invitations/accept` |  |
| GET | `/v1/households/invitations/incoming` |  |

## knowledge

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/knowledge/articles` |  |
| GET | `/v1/knowledge/articles/{slug}` |  |
| GET | `/v1/knowledge/topics` |  |

## me

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/me` |  |
| GET | `/v1/me/activity` |  |
| GET | `/v1/me/dashboard` |  |
| GET | `/v1/me/preferences` |  |
| PATCH | `/v1/me/preferences` |  |
| PATCH | `/v1/me/profile` |  |

## notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/notifications` |  |
| DELETE | `/v1/notifications/{id}` |  |
| GET | `/v1/notifications/devices` |  |
| POST | `/v1/notifications/devices` |  |
| DELETE | `/v1/notifications/devices/{id}` |  |
| GET | `/v1/notifications/preferences` |  |
| PUT | `/v1/notifications/preferences` |  |
| POST | `/v1/notifications/read` |  |
| POST | `/v1/notifications/webhooks/{provider}/delivery` |  |
| GET | `/v1/notifications/webpush/public-key` |  |

## privacy

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/privacy/consents` |  |
| POST | `/v1/privacy/consents` |  |
| DELETE | `/v1/privacy/consents/{purpose}` |  |
| GET | `/v1/privacy/data-inventory` |  |
| POST | `/v1/privacy/delete-account` |  |
| GET | `/v1/privacy/notice` |  |
| GET | `/v1/privacy/requests` |  |
| POST | `/v1/privacy/requests` |  |
| GET | `/v1/privacy/requests/{id}` |  |
| POST | `/v1/privacy/requests/{id}/cancel` |  |
| GET | `/v1/privacy/requests/{id}/download` |  |

## provider-portal

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/provider-portal/providers` |  |
| POST | `/v1/provider-portal/providers` |  |
| GET | `/v1/provider-portal/providers/{id}` |  |
| PATCH | `/v1/provider-portal/providers/{id}` |  |
| PUT | `/v1/provider-portal/providers/{id}/areas` |  |
| POST | `/v1/provider-portal/providers/{id}/members` |  |
| DELETE | `/v1/provider-portal/providers/{id}/members/{userId}` |  |
| GET | `/v1/provider-portal/providers/{id}/open-requests` |  |
| POST | `/v1/provider-portal/providers/{id}/open-requests/{requestId}/claim` |  |
| GET | `/v1/provider-portal/providers/{id}/requests` |  |
| POST | `/v1/provider-portal/providers/{id}/reviews/{reviewId}/response` |  |
| POST | `/v1/provider-portal/providers/{id}/services` |  |
| PATCH | `/v1/provider-portal/providers/{id}/services/{serviceId}` |  |
| DELETE | `/v1/provider-portal/providers/{id}/services/{serviceId}` |  |
| POST | `/v1/provider-portal/providers/{id}/submit` |  |

## reminders

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/reminders` |  |
| POST | `/v1/reminders` |  |
| GET | `/v1/reminders/{id}` |  |
| PATCH | `/v1/reminders/{id}` |  |
| DELETE | `/v1/reminders/{id}` |  |

## service-requests

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/service-requests` |  |
| POST | `/v1/service-requests` |  |
| GET | `/v1/service-requests/{id}` |  |
| PATCH | `/v1/service-requests/{id}` |  |
| POST | `/v1/service-requests/{id}/review` |  |
| POST | `/v1/service-requests/{id}/status` |  |

## services

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/services/categories` |  |
| GET | `/v1/services/providers` |  |
| GET | `/v1/services/providers/{id}` |  |
| GET | `/v1/services/providers/{id}/reviews` |  |

## sharing

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/grants` |  |
| POST | `/v1/grants` |  |
| DELETE | `/v1/grants/{id}` |  |
| GET | `/v1/grants/scopes` |  |
| GET | `/v1/grants/who-can-see-me` |  |

## shopping-lists

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/lists` |  |
| POST | `/v1/lists` |  |
| GET | `/v1/lists/{id}` |  |
| PATCH | `/v1/lists/{id}` |  |
| DELETE | `/v1/lists/{id}` |  |
| POST | `/v1/lists/{id}/clear-done` |  |
| POST | `/v1/lists/{id}/items` |  |
| PATCH | `/v1/lists/items/{itemId}` |  |
| DELETE | `/v1/lists/items/{itemId}` |  |

## tasks

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/task-categories` |  |
| POST | `/v1/task-categories` |  |
| PATCH | `/v1/task-categories/{id}` |  |
| DELETE | `/v1/task-categories/{id}` |  |
| GET | `/v1/tasks` |  |
| POST | `/v1/tasks` |  |
| GET | `/v1/tasks/{id}` |  |
| PATCH | `/v1/tasks/{id}` |  |
| DELETE | `/v1/tasks/{id}` |  |
| POST | `/v1/tasks/{id}/assignments` |  |
| DELETE | `/v1/tasks/{id}/assignments/{userId}` |  |
| POST | `/v1/tasks/{id}/attachments` |  |
| DELETE | `/v1/tasks/{id}/attachments/{attachmentId}` |  |
| POST | `/v1/tasks/{id}/complete` |  |
| POST | `/v1/tasks/{id}/reopen` |  |
| POST | `/v1/tasks/assignments/{assignmentId}/respond` |  |
| GET | `/v1/tasks/assignments/incoming` |  |
| GET | `/v1/tasks/summary` |  |

