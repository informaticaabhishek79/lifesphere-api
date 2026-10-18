import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Actor, CurrentActor } from '../../common/auth-context';
import { loadEnv } from '../../config/env';
import { DocumentsService } from './documents.service';

class FolderCreateDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() parentId?: string | null;
}
class FolderUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional({ nullable: true, description: 'Move into this folder; null = top level' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() parentId?: string | null;
}
class FileUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() folderId?: string;
}
class TextFileDto {
  @ApiProperty() @IsUUID() folderId: string;
  @ApiProperty({ example: 'Notes.md' }) @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiProperty() @IsString() @MaxLength(200_000) content: string;
}
class TextContentDto {
  @ApiProperty() @IsString() @MaxLength(200_000) content: string;
}

@ApiTags('documents')
@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  constructor(private readonly svc: DocumentsService) {}

  /** All your folders, with a readable path and file count. */
  @Get('folders')
  folders(@CurrentActor() a: Actor) {
    return this.svc.listFolders(a);
  }

  @Post('folders')
  async createFolder(@CurrentActor() a: Actor, @Body() dto: FolderCreateDto) {
    const f = await this.svc.createFolder(a.userId, dto.name, dto.parentId ?? null);
    return this.svc.folderOut(f, await this.svc.paths(a.userId));
  }

  @Patch('folders/:id')
  async updateFolder(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FolderUpdateDto) {
    if (dto.name !== undefined) await this.svc.renameFolder(a.userId, id, dto.name);
    if (dto.parentId !== undefined) await this.svc.moveFolder(a.userId, id, dto.parentId);
    return this.svc.folderOut(await this.svc.folder(a.userId, id), await this.svc.paths(a.userId));
  }

  /** Moves the folder and everything in it to the bin. */
  @Delete('folders/:id')
  @HttpCode(204)
  binFolder(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.binFolder(a.userId, id);
  }

  @Post('folders/:id/restore')
  @HttpCode(200)
  async restoreFolder(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.folderOut(await this.svc.restoreFolder(a.userId, id));
  }

  @Get('folders/:id/files')
  async files(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.folder(a.userId, id);
    return (await this.svc.listFiles(a.userId, [id])).map((f) => this.svc.fileOut(f));
  }

  /** Upload into a folder (multipart field `file`). PDF, images, Word/Excel/PowerPoint and text; type is checked from the content. */
  @Post('folders/:id/files')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: loadEnv().DOCUMENT_MAX_BYTES + 1, files: 1 } }))
  async upload(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.svc.fileOut(await this.svc.upload(a, id, file));
  }

  @Post('files/text')
  async createText(@CurrentActor() a: Actor, @Body() dto: TextFileDto) {
    return this.svc.fileOut(await this.svc.createTextFile(a.userId, dto.folderId, dto.name, dto.content));
  }

  @Get('files/:id')
  async file(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.fileOut(await this.svc.file(a.userId, id));
  }

  /** The stored text of a text file (null for other types). */
  @Get('files/:id/text')
  async text(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const f = await this.svc.file(a.userId, id);
    return { id: f.id, text: f.textContent };
  }

  @Put('files/:id/text')
  async writeText(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TextContentDto) {
    return this.svc.fileOut(await this.svc.writeText(a.userId, id, dto.content));
  }

  @Get('files/:id/content')
  @ApiQuery({ name: 'inline', required: false, description: 'true to view in the browser (images, PDF, text)' })
  content(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query('inline') inline: string | undefined, @Res() res: Response) {
    return this.svc.sendFile(a, id, res, inline === 'true');
  }

  /** Rename and/or move a file. */
  @Patch('files/:id')
  async updateFile(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FileUpdateDto) {
    if (dto.folderId) await this.svc.moveFile(a.userId, id, dto.folderId);
    if (dto.name) await this.svc.renameFile(a.userId, id, dto.name);
    return this.svc.fileOut(await this.svc.file(a.userId, id));
  }

  @Delete('files/:id')
  @HttpCode(204)
  binFile(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.binFile(a.userId, id);
  }

  @Post('files/:id/restore')
  @HttpCode(200)
  async restoreFile(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.fileOut(await this.svc.restoreFile(a.userId, id));
  }

  /** Files and folders in the bin; purged automatically after the grace period. */
  @Get('bin')
  bin(@CurrentActor() a: Actor) {
    return this.svc.bin(a);
  }
}
