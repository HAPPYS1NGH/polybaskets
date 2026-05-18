import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProfileDto } from './profile.dto';

export class RegisterAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(66)
  account: string;

  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'name must be lowercase letters, digits, hyphens (3-20 chars)',
  })
  name: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileDto)
  profile?: ProfileDto;

  /** Unix-ms timestamp; must be within ±5min of server time. */
  @IsInt()
  ts: number;

  /** Caller-chosen unique nonce for replay protection. */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  nonce: string;

  /** SR25519/ED25519 hex signature over the canonical signable payload. */
  @IsString()
  @Matches(/^0x[a-fA-F0-9]+$/, { message: 'signature must be 0x-prefixed hex' })
  @MaxLength(200)
  signature: string;
}
