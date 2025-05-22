import { type IAgentRuntime, type UUID, logger, type Service } from '@elizaos/core';
import { TeamUpdateTrackerService } from './services/updateTracker';

export const registerTasks = async (runtime: IAgentRuntime, initialWorldId?: UUID) => {
  // Ensure worldId is set to the agent's ID if not provided
  const worldId = initialWorldId || runtime.agentId as UUID;

  // Try to get an existing service instance instead of creating a new one
  let teamUpdateService: TeamUpdateTrackerService;
  try {
    const existingService = runtime.getService(TeamUpdateTrackerService.serviceType);
    if (existingService) {
      logger.info('Using existing TeamUpdateTrackerService');
      teamUpdateService = existingService as TeamUpdateTrackerService;
    } else {
      logger.info('Creating new TeamUpdateTrackerService instance');
      teamUpdateService = new TeamUpdateTrackerService(runtime);
    }
  } catch (error) {
    logger.warn('Error getting existing service, creating new instance:', error);
    teamUpdateService = new TeamUpdateTrackerService(runtime);
  }

  // Clear existing tasks
  const tasks = await runtime.getTasks({
    tags: ['queue', 'repeat', 'team_coordinator'],
  });

  for (const task of tasks) {
    if (task.id) {
      await runtime.deleteTask(task.id);
    }
  }

  // Register the check-in service task worker
  runtime.registerTaskWorker({
    name: 'TEAM_CHECK_IN_SERVICE',
    validate: async (_runtime, _message, _state) => {
      return true;
    },
    execute: async (runtime, _options, task) => {
      try {
        logger.info('Running team check-in service job');
        await teamUpdateService.checkInServiceJob();
      } catch (error) {
        logger.error('Failed to run check-in service job:', error);
      }
    },
  });

  // Create the periodic task
  runtime.createTask({
    name: 'TEAM_CHECK_IN_SERVICE',
    description: 'Regular team check-in service job',
    worldId: worldId, // Explicitly pass worldId
    metadata: {
      updatedAt: Date.now(),
      updateInterval: 1000 * 60, // 1 minute
    },
    tags: ['queue', 'repeat', 'team_coordinator'],
  });
};
