import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { Env, ENV } from '../config/env';

export interface AccessClaims {
  sub: string;
  sid: string;
  amr: string[];
}

@Injectable()
export class TokenService {
  private readonly secret: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.secret = new TextEncoder().encode(env.JWT_SECRET);
  }

  async signAccess(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.env.ACCESS_TOKEN_TTL_SEC * 1000);
    const token = await new SignJWT({ sid: claims.sid, amr: claims.amr })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);
    return { token, expiresAt };
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { sub: payload.sub, sid: payload.sid, amr: Array.isArray(payload.amr) ? (payload.amr as string[]) : [] };
    } catch {
      return null;
    }
  }
}
