import { AttachmentsController } from './attachments/attachments.controller';
import { AttachmentsService } from './attachments/attachments.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { HealthController } from './health/health.controller';
import { DirectoryController, MeController } from './me/me.controller';
import { MeService } from './me/me.service';
import { NotificationsController } from './notifications/notifications.controller';
import { PrivacyController } from './privacy/privacy.controller';
import { PrivacyService } from './privacy/privacy.service';
import { HouseholdsController } from './households/households.controller';
import { HouseholdsService, InviteHelper } from './households/households.service';
import { RemindersController } from './reminders/reminders.controller';
import { RemindersService } from './reminders/reminders.service';
import { TaskCategoriesController, TasksController } from './tasks/tasks.controller';
import { TasksService } from './tasks/tasks.service';
import { CalendarController } from './calendar/calendar.controller';
import { CalendarService } from './calendar/calendar.service';
import { BudgetsController, InventoryController, ListsController } from './household-tools/household-tools.controller';
import { HouseholdToolsService } from './household-tools/household-tools.service';
import { ContactsController, GrantsController } from './contacts/contacts.controller';
import { ContactsService } from './contacts/contacts.service';
import { CheckinsController } from './checkins/checkins.controller';
import { CheckinsService } from './checkins/checkins.service';
import { HelpController } from './help/help.controller';
import { HelpService } from './help/help.service';
import { ConsumerController } from './consumer/consumer.controller';
import { ConsumerService } from './consumer/consumer.service';
import { CivicController, CommunityController } from './community/community.controller';
import { CommunityService } from './community/community.service';
import { ModerationService } from './moderation/moderation.service';
import { ProviderPortalController, ServiceRequestsController, ServicesController } from './services/services.controller';
import { ServicesService } from './services/services.service';
import { AssistantController, KnowledgeController } from './knowledge/knowledge.controller';
import { KnowledgeService } from './knowledge/knowledge.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { JobsService } from '../jobs/jobs.service';

export const FEATURE_CONTROLLERS = [
  HealthController,
  AuthController,
  MeController,
  DirectoryController,
  NotificationsController,
  PrivacyController,
  AttachmentsController,
  HouseholdsController,
  TasksController,
  TaskCategoriesController,
  RemindersController,
  CalendarController,
  ListsController,
  InventoryController,
  BudgetsController,
  ContactsController,
  GrantsController,
  CheckinsController,
  HelpController,
  ConsumerController,
  CommunityController,
  CivicController,
  ServicesController,
  ServiceRequestsController,
  ProviderPortalController,
  KnowledgeController,
  AssistantController,
  AdminController,
];
export const FEATURE_PROVIDERS = [
  AuthService,
  MeService,
  PrivacyService,
  AttachmentsService,
  InviteHelper,
  HouseholdsService,
  RemindersService,
  TasksService,
  CalendarService,
  HouseholdToolsService,
  ContactsService,
  CheckinsService,
  HelpService,
  ConsumerService,
  ModerationService,
  CommunityService,
  ServicesService,
  KnowledgeService,
  AdminService,
  JobsService,
];
