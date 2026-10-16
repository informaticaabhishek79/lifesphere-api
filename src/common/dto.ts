import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class TokenDto {
  @ApiProperty({ description: 'Invitation token from the invite link' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;
}

export class RespondDto {
  @ApiProperty() @IsBoolean() accept: boolean;
}

/** Strip undefined values so PATCH only touches fields that were sent. */
export function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
