import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { HouseholdToolsService } from './household-tools.service';

class HouseholdScopeQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() householdId?: string;
}

class ShoppingListQuery extends HouseholdScopeQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) includeArchived?: 'true' | 'false';
}

class CreateShoppingListDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() householdId?: string;
}

class UpdateShoppingListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() archived?: boolean;
}

class CreateListItemDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100000) quantity?: number;
  @ApiPropertyOptional({ example: 'kg' }) @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional({ example: 'Vegetables' }) @IsOptional() @IsString() @MaxLength(40) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) position?: number;
}

class UpdateListItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) quantity?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) unit?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) category?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() assignedTo?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) position?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() done?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class InventoryDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty({ example: 'appliance' }) @IsString() @MinLength(1) @MaxLength(40) category: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) roomOrLocation?: string;
  @ApiPropertyOptional({ example: '2025-04-01' }) @IsOptional() @Matches(DATE) installedOn?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) purchaseDate?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) warrantyExpiresOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() householdId?: string;
}

class UpdateInventoryDto extends PartialType(OmitType(InventoryDto, ['householdId'] as const)) {}

class InventoryQuery extends HouseholdScopeQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) category?: string;
}

class MaintenanceScheduleDto {
  @ApiProperty({ example: 'Clean AC filter' }) @IsString() @MinLength(1) @MaxLength(120) title: string;
  @ApiProperty({ example: 90 }) @Type(() => Number) @IsInt() @Min(1) @Max(3650) intervalDays: number;
  @ApiProperty({ example: '2026-11-01' }) @Matches(DATE) nextDueOn: string;
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(0) @Max(60) reminderLeadDays?: number;
}

class UpdateMaintenanceScheduleDto extends PartialType(MaintenanceScheduleDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class MaintenanceRecordDto {
  @ApiProperty() @Matches(DATE) performedOn: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) description: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) providerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() providerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() serviceRequestId?: string;
  @ApiPropertyOptional({ description: 'Advances this schedule’s next due date' }) @IsOptional() @IsUUID() scheduleId?: string;
}

class BudgetQuery extends HouseholdScopeQuery {
  @ApiProperty({ example: '2026-10-01' }) @Matches(/^\d{4}-\d{2}-01$/) month: string;
}

class BudgetLineDto {
  @ApiProperty({ example: '2026-10-01' }) @Matches(/^\d{4}-\d{2}-01$/) month: string;
  @ApiProperty({ example: 'Groceries' }) @IsString() @MinLength(1) @MaxLength(40) category: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(1e10) plannedAmount: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1e10) spentAmount?: number;
  @ApiPropertyOptional({ example: 'INR', description: 'ISO 4217; defaults to your country’s currency' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() householdId?: string;
}

class UpdateBudgetLineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(40) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) plannedAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) spentAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

@ApiTags('shopping-lists')
@Controller({ path: 'lists', version: '1' })
export class ListsController {
  constructor(private readonly svc: HouseholdToolsService) {}

  @Get()
  lists(@CurrentActor() actor: Actor, @Query() q: ShoppingListQuery) {
    return this.svc.lists(actor, q.householdId, q.includeArchived === 'true');
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: CreateShoppingListDto) {
    return this.svc.createList(actor, dto.name, dto.householdId);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getList(actor, id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateShoppingListDto) {
    return this.svc.updateList(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteList(actor, id);
  }

  @Post(':id/items')
  addItem(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateListItemDto) {
    return this.svc.addItem(actor, id, dto);
  }

  @Post(':id/clear-done')
  @HttpCode(200)
  clearDone(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.clearDone(actor, id);
  }

  @Patch('items/:itemId')
  updateItem(@CurrentActor() actor: Actor, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateListItemDto) {
    return this.svc.updateItem(actor, itemId, dto);
  }

  @Delete('items/:itemId')
  @HttpCode(204)
  deleteItem(@CurrentActor() actor: Actor, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.svc.deleteItem(actor, itemId);
  }
}

@ApiTags('home-inventory')
@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly svc: HouseholdToolsService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: InventoryQuery) {
    return this.svc.inventory(actor, q.householdId, q.category);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: InventoryDto) {
    return this.svc.createItem(actor, dto);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getItem(actor, id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInventoryDto) {
    return this.svc.updateItem2(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteInvItem(actor, id);
  }

  @Post(':id/schedules')
  addSchedule(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MaintenanceScheduleDto) {
    return this.svc.addSchedule(actor, id, dto);
  }

  @Patch(':id/schedules/:scheduleId')
  updateSchedule(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('scheduleId', ParseUUIDPipe) sid: string, @Body() dto: UpdateMaintenanceScheduleDto) {
    return this.svc.updateSchedule(actor, id, sid, dto);
  }

  @Delete(':id/schedules/:scheduleId')
  @HttpCode(204)
  deleteSchedule(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('scheduleId', ParseUUIDPipe) sid: string) {
    return this.svc.deleteSchedule(actor, id, sid);
  }

  @Post(':id/records')
  addRecord(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MaintenanceRecordDto) {
    return this.svc.addRecord(actor, id, dto);
  }

  @Delete(':id/records/:recordId')
  @HttpCode(204)
  deleteRecord(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('recordId', ParseUUIDPipe) rid: string) {
    return this.svc.deleteRecord(actor, id, rid);
  }
}

@ApiTags('budget')
@Controller({ path: 'budgets', version: '1' })
export class BudgetsController {
  constructor(private readonly svc: HouseholdToolsService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: BudgetQuery) {
    return this.svc.budgets(actor, q.month, q.householdId);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: BudgetLineDto) {
    return this.svc.createBudget(actor, dto);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBudgetLineDto) {
    return this.svc.updateBudget(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteBudget(actor, id);
  }
}

void IsDateString;
