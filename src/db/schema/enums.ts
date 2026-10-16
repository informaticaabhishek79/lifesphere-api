import { pgEnum } from 'drizzle-orm/pg-core';

// ---------- Identity ----------
export const userStatus = pgEnum('user_status', ['active', 'disabled', 'pending_deletion', 'deleted']);
export const otpChannel = pgEnum('otp_channel', ['sms', 'email']);
export const otpPurpose = pgEnum('otp_purpose', ['login', 'verify_email', 'verify_phone', 'reauth']);
export const staffRole = pgEnum('staff_role', [
  'support',
  'moderator',
  'privacy_officer',
  'provider_reviewer',
  'content_admin',
  'super_admin',
]);
export const lockScreenDetail = pgEnum('lock_screen_detail', ['none', 'generic', 'full']);
export const themePreference = pgEnum('theme_preference', ['system', 'light', 'dark', 'high_contrast']);

// ---------- Privacy ----------
export const privacyRequestType = pgEnum('privacy_request_type', ['export', 'delete', 'correction', 'grievance']);
export const privacyRequestStatus = pgEnum('privacy_request_status', [
  'received',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
]);
export const attachmentPurpose = pgEnum('attachment_purpose', [
  'task',
  'post',
  'consumer_case',
  'inventory',
  'export',
  'avatar',
  'provider',
  'civic',
]);
export const attachmentStatus = pgEnum('attachment_status', ['pending', 'ready', 'quarantined', 'deleted']);

// ---------- Households & tasks ----------
export const householdRole = pgEnum('household_role', ['admin', 'member']);
export const invitationStatus = pgEnum('invitation_status', ['pending', 'accepted', 'declined', 'expired', 'cancelled']);
export const taskPriority = pgEnum('task_priority', ['low', 'normal', 'high', 'urgent']);
export const taskStatus = pgEnum('task_status', ['pending', 'in_progress', 'completed', 'cancelled']);
export const taskVisibility = pgEnum('task_visibility', ['private', 'household', 'shared']);
export const assignmentStatus = pgEnum('assignment_status', ['proposed', 'accepted', 'declined']);
export const reminderStatus = pgEnum('reminder_status', ['scheduled', 'sent', 'failed', 'cancelled']);

// ---------- Notifications ----------
export const devicePlatform = pgEnum('device_platform', ['web', 'android', 'ios']);
export const notificationChannel = pgEnum('notification_channel', ['in_app', 'push', 'sms', 'email']);
export const notificationCategory = pgEnum('notification_category', [
  'reminders',
  'tasks',
  'household',
  'family',
  'checkins',
  'help',
  'community',
  'services',
  'consumer',
  'security',
  'privacy',
  'system',
]);
export const notificationJobStatus = pgEnum('notification_job_status', [
  'queued',
  'sending',
  'sent',
  'delivered',
  'failed',
  'suppressed',
  'simulated',
]);

// ---------- FamilyCare ----------
export const grantScope = pgEnum('grant_scope', [
  'tasks.view',
  'tasks.assign',
  'calendar.view',
  'checkins.view',
  'checkins.alerts',
  'help.alerts',
  'help.location',
]);
export const grantStatus = pgEnum('grant_status', ['pending_cooloff', 'active', 'revoked', 'expired']);
export const checkInKind = pgEnum('check_in_kind', ['daily', 'weekly', 'one_off', 'visit_confirmation', 'assistance_confirmation']);
export const checkInEventState = pgEnum('check_in_event_state', [
  'pending',
  'reminded',
  'completed',
  'missed',
  'escalated',
  'acknowledged',
  'cancelled',
]);
export const helpRequestKind = pgEnum('help_request_kind', ['notify_contacts', 'call', 'service_request']);
export const helpRequestStatus = pgEnum('help_request_status', ['open', 'acknowledged', 'resolved', 'cancelled']);
export const calendarEventKind = pgEnum('calendar_event_kind', ['appointment', 'visit', 'errand', 'activity', 'other']);
export const attendeeStatus = pgEnum('attendee_status', ['invited', 'accepted', 'declined', 'tentative']);

// ---------- Consumer ----------
export const consumerCaseStatus = pgEnum('consumer_case_status', [
  'draft',
  'ready_to_submit',
  'submitted_by_user',
  'awaiting_response',
  'info_required',
  'resolved',
  'closed',
]);
export const caseEventKind = pgEnum('case_event_kind', ['note', 'contact', 'response', 'status_change', 'follow_up']);
export const draftSource = pgEnum('draft_source', ['user', 'ai']);
export const officialChannelKind = pgEnum('official_channel_kind', ['consumer', 'civic', 'government', 'helpline']);

// ---------- Community ----------
export const groupVisibility = pgEnum('group_visibility', ['public', 'private', 'invite_only']);
export const groupRole = pgEnum('group_role', ['owner', 'admin', 'moderator', 'member']);
export const membershipStatus = pgEnum('membership_status', ['active', 'pending', 'banned', 'left']);
export const postingPolicy = pgEnum('posting_policy', ['all_members', 'admins_only']);
export const groupStatus = pgEnum('group_status', ['active', 'suspended', 'archived']);
export const postKind = pgEnum('post_kind', [
  'text',
  'announcement',
  'event',
  'recommendation',
  'help_request',
  'civic_info',
  'lost_found',
]);
export const contentStatus = pgEnum('content_status', ['published', 'hidden', 'removed', 'deleted']);
export const reactionKind = pgEnum('reaction_kind', ['like', 'helpful', 'thanks', 'support']);
export const civicCategory = pgEnum('civic_category', [
  'streetlight',
  'garbage',
  'road',
  'water',
  'drainage',
  'electricity',
  'public_safety',
  'other',
]);
export const civicStatus = pgEnum('civic_status', ['draft', 'reported_by_user', 'in_progress', 'resolved', 'closed']);

// ---------- Moderation ----------
export const reportTargetType = pgEnum('report_target_type', [
  'post',
  'comment',
  'user',
  'group',
  'provider',
  'service_request',
  'review',
]);
export const reportReason = pgEnum('report_reason', [
  'spam',
  'harassment',
  'hate',
  'fraud',
  'impersonation',
  'privacy',
  'unsafe',
  'misinformation',
  'other',
]);
export const reportStatus = pgEnum('report_status', ['open', 'in_review', 'actioned', 'dismissed']);
export const moderationActionKind = pgEnum('moderation_action_kind', [
  'hide',
  'remove',
  'restore',
  'warn',
  'suspend_posting',
  'suspend',
  'ban',
  'dismiss',
]);
export const appealStatus = pgEnum('appeal_status', ['open', 'upheld', 'overturned']);
export const sanctionKind = pgEnum('sanction_kind', ['warning', 'posting_suspended', 'suspended', 'banned']);

// ---------- Providers ----------
export const providerType = pgEnum('provider_type', ['individual', 'business', 'volunteer', 'organisation']);
export const providerStatus = pgEnum('provider_status', ['draft', 'pending_review', 'active', 'suspended', 'rejected']);
export const verificationLevel = pgEnum('verification_level', ['none', 'basic', 'screened']);
export const providerMemberRole = pgEnum('provider_member_role', ['owner', 'staff']);
export const verificationCheckType = pgEnum('verification_check_type', [
  'identity',
  'address',
  'background',
  'business_registration',
  'reference',
  'training',
]);
export const verificationStatus = pgEnum('verification_status', ['pending', 'passed', 'failed', 'expired']);
export const serviceRequestStatus = pgEnum('service_request_status', [
  'requested',
  'accepted',
  'declined',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'disputed',
]);

// ---------- Knowledge & AI ----------
export const sourceKind = pgEnum('source_kind', ['official', 'ngo', 'internal', 'other']);
export const articleStatus = pgEnum('article_status', ['draft', 'published', 'archived']);
export const aiRole = pgEnum('ai_role', ['user', 'assistant']);
export const feedbackRating = pgEnum('feedback_rating', ['up', 'down']);

// ---------- Platform ----------
export const actorType = pgEnum('actor_type', ['user', 'staff', 'system']);
export const subscriptionSubject = pgEnum('subscription_subject', ['user', 'household', 'provider']);
export const subscriptionStatus = pgEnum('subscription_status', ['active', 'cancelled', 'expired']);
