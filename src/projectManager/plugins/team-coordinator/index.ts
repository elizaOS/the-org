// biome-ignore lint/style/useImportType: <explanation>
import type { IAgentRuntime, Plugin } from '@elizaos/core';
// import { checkInFormatAction } from './actions/checkInFormatAction';
import { CheckInService } from './services/checkInService';
import { logger } from '@elizaos/core';
import { listCheckInSchedules } from './actions/checkInList';
import { TeamUpdateTrackerService } from './services/updateTracker';
import { recordCheckInAction } from './actions/checkInCreate';
import { generateReport } from './actions/reportGenerate';
import { teamMemberUpdatesAction } from './actions/teamMemberUpdate';
import { addTeamMemberAction } from './actions/teamMemberAdd';
import { listTeamMembersAction } from './actions/teamMembersList';
import { updatesFormatAction } from './actions/updateFormat';
import { registerTasks } from './tasks';

/**
 * Plugin for team coordination functionality
 * Handles team member management, availability tracking, and check-ins
 */
export const teamCoordinatorPlugin: Plugin = {
  name: 'team-coordinator',
  description: 'Team Coordinator plugin for managing team activities',
  providers: [],
  actions: [
    // checkInFormatAction,
    teamMemberUpdatesAction,
    listCheckInSchedules,
    generateReport,
    recordCheckInAction,
    addTeamMemberAction,
    listTeamMembersAction,
    updatesFormatAction,
  ],
  init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
    try {
      logger.info('Initializing Team Coordinator plugin...');

      // Register the services
      logger.info('Registering TeamUpdateTrackerService...');
      await runtime.registerService(TeamUpdateTrackerService);

      // Register and start the CheckIn service
      // logger.info('Registering CheckInService...');
      // await runtime.registerService(CheckInService);

      // Register tasks
      logger.info('Registering team coordinator tasks...');
      await registerTasks(runtime);

      logger.info('Team Coordinator plugin initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Team Coordinator plugin:', error);
      throw error;
    }
  },
  // List services that should be registered by the runtime
  services: [TeamUpdateTrackerService, CheckInService],
};

export function initialize(runtime: IAgentRuntime) {
  // Initialize services
  new CheckInService(runtime);
  // new ScheduleService(runtime);

  // Return actions
  return {
    actions: [
      // checkInFormatAction,
      recordCheckInAction,
      teamMemberUpdatesAction,
      listCheckInSchedules,
      generateReport,
      addTeamMemberAction,
      listTeamMembersAction,
      updatesFormatAction,
    ],
  };
}

export default {
  initialize,
};
