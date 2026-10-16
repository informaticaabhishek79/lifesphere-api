import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor, CurrentActor } from '../../common/auth-context';
import { RespondDto } from '../../common/dto';
import { TaskAssignDto, AttachmentLinkDto, TaskCategoryDto, CreateTaskDto, TaskQuery, UpdateTaskCategoryDto, UpdateTaskDto } from './tasks.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller({ path: 'tasks', version: '1' })
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: TaskQuery) {
    return this.svc.list(actor, q);
  }

  @Get('summary')
  summary(@CurrentActor() actor: Actor) {
    return this.svc.summary(actor);
  }

  /** Tasks other people suggested for you (via a tasks.assign grant) awaiting your answer. */
  @Get('assignments/incoming')
  incoming(@CurrentActor() actor: Actor) {
    return this.svc.incomingAssignments(actor);
  }

  @Post('assignments/:assignmentId/respond')
  @HttpCode(200)
  respond(@CurrentActor() actor: Actor, @Param('assignmentId', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.svc.respondAssignment(actor, id, dto.accept);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: CreateTaskDto) {
    return this.svc.create(actor, dto);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(actor, id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.svc.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(actor, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.complete(actor, id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reopen(actor, id);
  }

  @Post(':id/assignments')
  assign(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TaskAssignDto) {
    return this.svc.assign(actor, id, dto.userId);
  }

  @Delete(':id/assignments/:userId')
  @HttpCode(204)
  unassign(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.unassign(actor, id, userId);
  }

  @Post(':id/attachments')
  attach(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachmentLinkDto) {
    return this.svc.attach(actor, id, dto.attachmentId);
  }

  @Delete(':id/attachments/:attachmentId')
  @HttpCode(204)
  detach(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('attachmentId', ParseUUIDPipe) attachmentId: string) {
    return this.svc.detach(actor, id, attachmentId);
  }
}

@ApiTags('tasks')
@Controller({ path: 'task-categories', version: '1' })
export class TaskCategoriesController {
  constructor(private readonly svc: TasksService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.svc.categories(actor);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: TaskCategoryDto) {
    return this.svc.createCategory(actor, dto);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskCategoryDto) {
    return this.svc.updateCategory(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteCategory(actor, id);
  }
}
