import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../../common/ids';

/** Time-ordered, non-guessable primary key (UUIDv7). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });

export const ts = (name: string) => timestamp(name, { withTimezone: true });
