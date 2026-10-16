import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class OtpRequestDto {
  @ApiProperty({ enum: ['sms', 'email'] })
  @IsIn(['sms', 'email'])
  channel: 'sms' | 'email';

  @ApiProperty({ example: '+919876543210', description: 'Phone number (E.164 or 10-digit Indian) or email address' })
  @IsString()
  @MinLength(5)
  @MaxLength(254)
  destination: string;
}

export class DeviceInfoDto {
  @ApiPropertyOptional({ example: 'Chrome on Windows' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @ApiPropertyOptional({ enum: ['web', 'android', 'ios'] })
  @IsOptional()
  @IsIn(['web', 'android', 'ios'])
  platform?: 'web' | 'android' | 'ios';
}

export class OtpVerifyDto extends DeviceInfoDto {
  @ApiProperty() @IsUUID() challengeId: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;

  @ApiPropertyOptional({ description: 'Required for new accounts: display name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ description: 'Required for new accounts: user confirms they are 18 or older' })
  @IsOptional()
  @IsBoolean()
  ageConfirmed?: boolean;

  @ApiPropertyOptional({ description: 'Required for new accounts: version of terms + privacy notice accepted' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  acceptedPolicyVersion?: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @ApiPropertyOptional({ example: 'en-IN' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;
}

export class MfaVerifyDto {
  @ApiProperty({ description: 'mfaToken returned by /auth/otp/verify when two-factor is enabled' })
  @IsString()
  @MaxLength(2000)
  mfaToken: string;

  @ApiPropertyOptional({ description: '6-digit authenticator code' })
  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;

  @ApiPropertyOptional({ description: 'One-time recovery code' })
  @IsOptional()
  @IsString()
  @Length(8, 20)
  recoveryCode?: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(200) refreshToken: string;
}

export class TotpConfirmDto {
  @ApiProperty() @Matches(/^\d{6}$/) code: string;
}

export class ReauthRequestDto {
  @ApiProperty({ enum: ['sms', 'email'] }) @IsIn(['sms', 'email']) channel: 'sms' | 'email';
}

export class ReauthVerifyDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() challengeId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{6}$/) code?: string;
  @ApiPropertyOptional({ description: 'Authenticator code instead of OTP' }) @IsOptional() @Matches(/^\d{6}$/) totpCode?: string;
}

export class ContactVerifyRequestDto {
  @ApiProperty({ enum: ['sms', 'email'] }) @IsIn(['sms', 'email']) channel: 'sms' | 'email';
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(254) destination: string;
}

export class ContactVerifyDto {
  @ApiProperty() @IsUUID() challengeId: string;
  @ApiProperty() @Matches(/^\d{6}$/) code: string;
}

export class DisableTotpDto {
  @ApiProperty({ description: 'Must be true to confirm' }) @Equals(true) confirm: boolean;
}
