import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { CursorQuery } from '../../common/pagination';
import { ServicesService } from './services.service';

const PROVIDER_TYPES = ['individual', 'business', 'volunteer', 'organisation'] as const;
const STATUSES = ['requested', 'accepted', 'declined', 'scheduled', 'in_progress', 'completed', 'cancelled', 'disputed'] as const;

class DirectoryQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() localityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) verifiedOnly?: 'true' | 'false';
}

class ProviderProfileDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) displayName: string;
  @ApiProperty({ enum: PROVIDER_TYPES }) @IsIn(PROVIDER_TYPES as unknown as string[]) providerType: (typeof PROVIDER_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?\d{8,15}$/) phonePublic?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(160) emailPublic?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(300) websiteUrl?: string;
}

class UpdateProviderProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\+?\d{8,15}$/) phonePublic?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(160) emailPublic?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(300) websiteUrl?: string;
}

class ProviderServiceDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ example: 'Visit charge ₹300, parts extra' }) @IsOptional() @IsString() @MaxLength(200) priceNote?: string;
}

class UpdateProviderServiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) priceNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class ProviderAreasDto {
  @ApiProperty({ type: [String] }) @IsUUID('all', { each: true }) @ArrayMaxSize(100) localityIds: string[];
}

class ProviderMemberDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ enum: ['owner', 'staff'] }) @IsIn(['owner', 'staff']) role: 'owner' | 'staff';
}

class ServiceRequestDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiPropertyOptional({ description: 'Leave empty to post an open request to providers in your area' }) @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerServiceId?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() localityId?: string;
  @ApiPropertyOptional({ description: 'Visit address or landmark — shown to the provider only after they accept' }) @IsOptional() @IsString() @MaxLength(300) locationNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() preferredStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() preferredEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inventoryItemId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() consumerCaseId?: string;
  @ApiPropertyOptional({ description: 'A trusted contact you are arranging this for' }) @IsOptional() @IsUUID() onBehalfOfUserId?: string;
}

class UpdateServiceRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) locationNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() preferredStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() preferredEnd?: string;
}

class ServiceRequestQuery extends CursorQuery {
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
}

class ServiceRequestTransitionDto {
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES as unknown as string[]) status: (typeof STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledAt?: string;
}

class ProviderReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) body?: string;
}

class ProviderReviewResponseDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) response: string;
}

@ApiTags('services')
@Controller({ path: 'services', version: '1' })
export class ServicesController {
  constructor(private readonly svc: ServicesService) {}

  @Get('categories')
  categories() {
    return this.svc.categories();
  }

  @Get('providers')
  directory(@CurrentActor() actor: Actor, @Query() q: DirectoryQuery) {
    return this.svc.directory(actor, { ...q, verifiedOnly: q.verifiedOnly === 'true' });
  }

  @Get('providers/:id')
  provider(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.provider(actor, id);
  }

  @Get('providers/:id/reviews')
  reviews(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: CursorQuery) {
    return this.svc.reviews(actor, id, q);
  }
}

@ApiTags('service-requests')
@Controller({ path: 'service-requests', version: '1' })
export class ServiceRequestsController {
  constructor(private readonly svc: ServicesService) {}

  @Get()
  mine(@CurrentActor() actor: Actor, @Query() q: ServiceRequestQuery) {
    return this.svc.myRequests(actor, q);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: ServiceRequestDto) {
    return this.svc.createRequest(actor, dto);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.requestDetail(actor, id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceRequestDto) {
    return this.svc.updateRequest(actor, id, dto);
  }

  /** Customer: cancel or dispute. Provider: accept, decline, schedule, start, complete. */
  @Post(':id/status')
  @HttpCode(200)
  transition(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ServiceRequestTransitionDto) {
    return this.svc.transition(actor, id, dto.status, dto);
  }

  @Post(':id/review')
  review(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderReviewDto) {
    return this.svc.review(actor, id, dto.rating, dto.body);
  }
}

@ApiTags('provider-portal')
@Controller({ path: 'provider-portal', version: '1' })
export class ProviderPortalController {
  constructor(private readonly svc: ServicesService) {}

  @Get('providers')
  mine(@CurrentActor() actor: Actor) {
    return this.svc.myProviders(actor);
  }

  @Post('providers')
  create(@CurrentActor() actor: Actor, @Body() dto: ProviderProfileDto) {
    return this.svc.createProvider(actor, dto);
  }

  @Get('providers/:id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.portalGet(actor, id);
  }

  @Patch('providers/:id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProviderProfileDto) {
    return this.svc.updateProvider(actor, id, dto);
  }

  @Post('providers/:id/submit')
  @HttpCode(200)
  submit(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submitForReview(actor, id);
  }

  @Post('providers/:id/services')
  addService(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderServiceDto) {
    return this.svc.addService(actor, id, dto);
  }

  @Patch('providers/:id/services/:serviceId')
  updateService(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('serviceId', ParseUUIDPipe) sid: string, @Body() dto: UpdateProviderServiceDto) {
    return this.svc.updateService(actor, id, sid, dto);
  }

  @Delete('providers/:id/services/:serviceId')
  @HttpCode(204)
  deleteService(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('serviceId', ParseUUIDPipe) sid: string) {
    return this.svc.deleteService(actor, id, sid);
  }

  @Put('providers/:id/areas')
  areas(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderAreasDto) {
    return this.svc.setAreas(actor, id, dto.localityIds);
  }

  @Post('providers/:id/members')
  addMember(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderMemberDto) {
    return this.svc.addMember(actor, id, dto.userId, dto.role);
  }

  @Delete('providers/:id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.removeMember(actor, id, userId);
  }

  @Get('providers/:id/requests')
  requests(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: ServiceRequestQuery) {
    return this.svc.providerRequests(actor, id, q);
  }

  @Get('providers/:id/open-requests')
  open(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.openRequests(actor, id);
  }

  @Post('providers/:id/open-requests/:requestId/claim')
  @HttpCode(200)
  claim(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) rid: string) {
    return this.svc.claim(actor, id, rid);
  }

  @Post('providers/:id/reviews/:reviewId/response')
  @HttpCode(200)
  respond(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('reviewId', ParseUUIDPipe) rid: string, @Body() dto: ProviderReviewResponseDto) {
    return this.svc.respondToReview(actor, id, rid, dto.response);
  }
}
