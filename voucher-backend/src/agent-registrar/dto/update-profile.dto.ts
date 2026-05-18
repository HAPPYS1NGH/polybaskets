import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProfileDto } from './profile.dto';

export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(66)
  account: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => ProfileDto)
  profile: ProfileDto;

  @IsInt()
  ts: number;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  nonce: string;

  @IsString()
  @Matches(/^0x[a-fA-F0-9]+$/, { message: 'signature must be 0x-prefixed hex' })
  @MaxLength(200)
  signature: string;
}
