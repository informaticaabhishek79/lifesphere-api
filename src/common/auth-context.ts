import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export type StaffRoleName = 'support' | 'moderator' | 'privacy_officer' | 'provider_reviewer' | 'content_admin' | 'super_admin';

export interface Actor {
  userId: string;
  sessionId: string;
  amr: string[];
  mfaVerified: boolean;
  sessionCreatedAt: Date;
  reauthAt: Date | null;
  staffRoles: StaffRoleName[];
  ipHash: string | null;
}

export interface AuthedRequest extends Request {
  actor?: Actor;
}

export const IS_PUBLIC = 'auth:public';
export const STAFF_ROLES = 'auth:staff_roles';
export const RECENT_AUTH = 'auth:recent_auth_minutes';
export const IDEMPOTENT = 'http:idempotent';

/** Endpoint does not require a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Endpoint is for platform staff holding at least one of these roles (super_admin always passes). MFA required. */
export const StaffOnly = (...roles: StaffRoleName[]) => SetMetadata(STAFF_ROLES, roles);

/** Sensitive action: the session must have re-authenticated (OTP or TOTP) within N minutes. */
export const RequireRecentAuth = (minutes = 10) => SetMetadata(RECENT_AUTH, minutes);

/** Requires an Idempotency-Key header; a replay returns the first response. */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.actor as Actor;
});
