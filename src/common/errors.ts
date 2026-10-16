import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  ValidationError,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';

/** RFC 9457 problem details. `code` is a stable machine-readable identifier for clients. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  errors?: { field: string; message: string }[];
  [k: string]: unknown;
}

export class AppError extends HttpException {
  constructor(status: number, code: string, detail?: string, extra: Record<string, unknown> = {}) {
    super({ code, detail, ...extra }, status);
  }
}

/** Use for both "doesn't exist" and "exists but you may not see it" so ids cannot be probed. */
export const notFound = (what = 'Resource') => new NotFoundException({ code: 'not_found', detail: `${what} not found` });
export const forbidden = (detail = 'You do not have permission to do this', code = 'forbidden') =>
  new ForbiddenException({ code, detail });
export const conflict = (detail: string, code = 'conflict') => new ConflictException({ code, detail });
export const badRequest = (detail: string, code = 'bad_request') => new BadRequestException({ code, detail });
export const unprocessable = (detail: string, code = 'invalid_state') => new UnprocessableEntityException({ code, detail });

export function flattenValidationErrors(errors: ValidationError[], parent = ''): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    for (const msg of Object.values(e.constraints ?? {})) out.push({ field, message: msg });
    if (e.children?.length) out.push(...flattenValidationErrors(e.children, field));
  }
  return out;
}

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Authentication required',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable entity',
  428: 'Precondition required',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const problem = this.toProblem(exception);
    problem.instance = req.originalUrl?.split('?')[0];
    if (problem.status >= 500) {
      // Log the error class and message only — never request bodies (may contain personal data).
      const err = exception as Error;
      this.logger.error(`${err?.name ?? 'Error'}: ${err?.message ?? String(exception)}`, err?.stack);
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ThrottlerException) {
      return this.make(429, 'rate_limited', 'Too many requests. Please wait and try again.');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        const code = (b.code as string) ?? this.defaultCode(status);
        const detail = (b.detail as string) ?? (Array.isArray(b.message) ? undefined : (b.message as string | undefined));
        const { code: _c, detail: _d, message: _m, statusCode: _s, error: _e, ...rest } = b;
        return { ...this.make(status, code, detail), ...rest };
      }
      return this.make(status, this.defaultCode(status), String(body));
    }
    const pg = exception as { code?: string; constraint?: string };
    if (pg?.code === '23505') return this.make(409, 'duplicate', 'This already exists.');
    if (pg?.code === '23503') return this.make(400, 'invalid_reference', 'A referenced item does not exist.');
    if (pg?.code === '23514') return this.make(400, 'constraint_violation', 'The data violates a rule.');
    if (pg?.code === '22P02') return this.make(400, 'invalid_input', 'Invalid input value.');
    return this.make(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  private make(status: number, code: string, detail?: string): ProblemDetails {
    return {
      type: `https://docs.lifesphere.app/problems/${code}`,
      title: TITLES[status] ?? HttpStatus[status] ?? 'Error',
      status,
      code,
      ...(detail ? { detail } : {}),
    };
  }

  private defaultCode(status: number) {
    return (
      {
        400: 'bad_request',
        401: 'unauthenticated',
        403: 'forbidden',
        404: 'not_found',
        409: 'conflict',
        413: 'payload_too_large',
        415: 'unsupported_media_type',
        422: 'invalid_state',
        428: 'precondition_required',
        429: 'rate_limited',
      }[status] ?? 'error'
    );
  }
}
