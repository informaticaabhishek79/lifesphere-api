import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { and, AnyColumn, eq, gt, lt, or, SQL } from 'drizzle-orm';
import { badRequest } from './errors';

export class CursorQuery {
  @ApiPropertyOptional({ description: 'Opaque cursor from a previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type CursorValue = { v: string | number | null; id: string; k: 'd' | 's' | 'n' };

export function encodeCursor(value: Date | string | number | null, id: string): string {
  const c: CursorValue =
    value instanceof Date
      ? { v: value.toISOString(), id, k: 'd' }
      : typeof value === 'number'
        ? { v: value, id, k: 'n' }
        : { v: value, id, k: 's' };
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(cursor: string): { value: Date | string | number | null; id: string } {
  try {
    const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorValue;
    if (typeof c.id !== 'string') throw new Error();
    const value = c.k === 'd' && typeof c.v === 'string' ? new Date(c.v) : c.v;
    return { value, id: c.id };
  } catch {
    throw badRequest('Invalid pagination cursor', 'invalid_cursor');
  }
}

/** Keyset condition for ORDER BY (col dir, id dir). Columns must be NOT NULL. */
export function keyset(col: AnyColumn, idCol: AnyColumn, cursor: string | undefined, dir: 'asc' | 'desc' = 'desc'): SQL | undefined {
  if (!cursor) return undefined;
  const { value, id } = decodeCursor(cursor);
  const cmp = dir === 'desc' ? lt : gt;
  return or(cmp(col, value), and(eq(col, value), cmp(idCol, id)));
}

export function pageOf<T>(rows: T[], limit: number, key: (row: T) => [Date | string | number | null, string]): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(...key(last)) : null };
}

export const lim = (q: CursorQuery) => q.limit ?? 25;
