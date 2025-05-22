import {
  type IAgentRuntime,
  logger,
  type Memory,
  createUniqueUuid,
  Service,
  ChannelType,
  type UUID,
} from '@elizaos/core';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  SelectMenuInteraction,
  User,
} from 'discord.js';
import type { CheckInSchedule } from '../../../types';

// Extension of CheckInSchedule with additional fields
interface ExtendedCheckInSchedule extends CheckInSchedule {
  teamMemberId?: string;
  teamMemberName?: string;
  teamMemberUserName?: string;
}

// Interface for storing report channel configuration
interface ReportChannelConfig {
  serverId?: string; // Made optional
  serverName: string;
  channelId: string;
  createdAt: string;
}

type BaseInteraction = ButtonInteraction | StringSelectMenuInteraction | SelectMenuInteraction;

// Define our custom interaction type
interface ExtendedInteraction {
  customId: string;
  user?: User;
  member?: { user?: { id: string } };
  selections?: {
    checkin_frequency?: string[];
    checkin_time?: string[];
    timezone?: string[];
    checkin_days?: string[];
    checkin_type?: string[];
    checkin_channel?: string[];
    report_channel?: string[]; // Added for report channel selection
    server_info?: string[]; // Added for server info
  };
  guildId?: string; // Added for server ID
}

interface DiscordService extends Service {
  client: {
    users: {
      fetch: (userId: string) => Promise<User>;
    };
  };
}

export class CheckInService extends Service {
  private formSelections: Map<string, Record<string, string[]>> = new Map();
  private reportChannelConfigs: Map<string, ReportChannelConfig> = new Map(); // Store report channel configs by server ID
  static serviceType = 'CHECKIN_SERVICE';
  capabilityDescription = 'Manages team member check-in schedules';

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
  }

  async start(): Promise<void> {
    logger.info('=== INITIALIZING CHECKIN SERVICE ===');
    await this.initialize();
    await this.loadReportChannelConfigs(); // Load existing report channel configs

    logger.info('CheckIn Service started successfully');
  }

  async stop(): Promise<void> {
    logger.info('Stopping CheckIn Service');
    // Cleanup if needed
  }

  static async start(runtime: IAgentRuntime): Promise<CheckInService> {
    const service = new CheckInService(runtime);
    await service.start();
    return service;
  }

  private async initialize() {
    // Listen for Discord interactions
    this.runtime.registerEvent('DISCORD_INTERACTION', async (event) => {
      try {
        logger.info('=== DISCORD INTERACTION RECEIVED ===');
        logger.info('Raw event:', event);

        if (!event) {
          logger.error('Event is undefined or null');
          return;
        }

        const { interaction } = event;
        if (!interaction) {
          logger.error('No interaction in event:', event);
          return;
        }

        logger.info('Basic interaction info:', {
          exists: !!interaction,
          customId: interaction?.customId || 'NO_CUSTOM_ID',
          type: interaction?.type || 'NO_TYPE',
          hasUser: !!interaction?.user,
          hasSelections: !!interaction?.selections,
          allFields: Object.keys(interaction || {}),
        });

        // Check if this is a button interaction
        if (interaction.isButton?.()) {
          logger.info('Button interaction detected');
        }

        // Check if this is a modal submit
        if (interaction.isModalSubmit?.()) {
          logger.info('Modal submit detected');
        }

        if (interaction.customId === 'submit_checkin_schedule') {
          logger.info('Found matching customId: submit_checkin_schedule');
          await this.handleCheckInSubmission(interaction as ExtendedInteraction);
        } else if (interaction.customId === 'submit_report_channel') {
          logger.info('Found matching customId: submit_report_channel');
          await this.handleReportChannelSubmission(interaction as ExtendedInteraction);
        } else {
          logger.info('CustomId did not match. Received:', interaction.customId);
        }
      } catch (error: unknown) {
        const err = error as Error;
        logger.error('Error in DISCORD_INTERACTION event handler:', err);
        logger.error('Error stack:', err.stack);
      }
    });

    logger.info('CheckIn Service initialized and listening for events');
  }

  public async ensureDiscordClient(runtime: IAgentRuntime): Promise<DiscordService> {
    logger.info('Ensuring Discord client is available');

    try {
      const discordService = runtime.getService('discord');
      logger.info(`Discord service found: ${!!discordService}`);

      if (!discordService) {
        logger.error('Discord service not found in runtime');
        throw new Error('Discord service not found');
      }
      
      // Cast to DiscordService after null check
      const typedDiscordService = discordService as unknown as DiscordService;

      // Log what's in the service to see its structure
      logger.info(`Discord service structure: ${JSON.stringify(Object.keys(typedDiscordService))}`);

      // Check if client exists and is ready
      logger.info(`Discord client exists: ${!!typedDiscordService?.client}`);
      if (!typedDiscordService?.client) {
        logger.error('Discord client not initialized in service');
        throw new Error('Discord client not initialized');
      }

      logger.info('Discord client successfully validated');
      return typedDiscordService;
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`Error ensuring Discord client: ${err.message}`);
      logger.error(`Error stack: ${err.stack}`);
      throw error;
    }
  }

  private async handleCheckInSubmission(interaction: ExtendedInteraction) {
    try {
      logger.info('=== HANDLING CHECKIN SUBMISSION ===');

      const selections = interaction.selections;
      const userId = interaction.user?.id || interaction.member?.user?.id;
      let userDetails: User | null = null;

      // TODO : get discord service cool or in start
      const discordService = (await this.ensureDiscordClient(this.runtime)) as DiscordService;

      // Fetch user details
      try {
        if (userId) {
          userDetails = await discordService.client.users.fetch(userId);
          logger.info('Fetched user details:', {
            id: userDetails.id,
            username: userDetails.username,
            displayName: userDetails.displayName,
            bot: userDetails.bot,
            createdAt: userDetails.createdAt,
          });
        } else {
          logger.error('No user ID found in interaction');
        }
      } catch (userError: unknown) {
        const err = userError as Error;
        logger.error('Error fetching user details:', err);
        logger.error('User ID that caused error:', userId);
      }

      logger.info('Full interaction details:', JSON.stringify(interaction, null, 2));

      logger.info('Processing submission from user:', userId);
      logger.info('Form selections:', selections);

      if (!selections) {
        logger.warn('No form data found in submission');
        await this.runtime.emitEvent('DISCORD_RESPONSE', {
          type: 'REPLY',
          content: 'No form data received. Please try again.',
          ephemeral: true,
          interaction,
        });
        return;
      }

      // Create check-in schedule
      const schedule: ExtendedCheckInSchedule = {
        type: 'team-member-checkin-schedule',
        scheduleId: createUniqueUuid(this.runtime, `schedule-${Date.now()}`),
        teamMemberId: userId?.toString(),
        teamMemberName: userDetails?.displayName?.toString(),
        teamMemberUserName: userDetails?.username?.toString(),
        checkInType: selections.checkin_type?.[0] || 'STANDUP',
        channelId: selections.checkin_channel?.[0] || '',
        frequency: (selections.checkin_frequency?.[0] || 'WEEKLY') as CheckInSchedule['frequency'],
        checkInTime: selections.checkin_time?.[0] || '09:00',
        serverId: interaction.guildId,
        source: 'discord',
        createdAt: new Date().toISOString(),
      };

      // Store the schedule
      const roomId = createUniqueUuid(this.runtime, 'check-in-schedules');
      await this.storeCheckInSchedule(roomId, schedule);

      logger.info('Successfully stored check-in schedule:', schedule);

      // Send confirmation message
      await this.runtime.emitEvent('DISCORD_RESPONSE', {
        type: 'REPLY',
        content: `✅ Check-in schedule created!\nType: ${schedule.checkInType}\nFrequency: ${schedule.frequency}\nTime: ${schedule.checkInTime}`,
        ephemeral: true,
        interaction,
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Error in handleCheckInSubmission:', err);
      logger.error('Error stack:', err.stack);

      try {
        // Check if this is a duplicate key error
        if ('code' in err && err.code === '23505' && 'constraint' in err && err.constraint === 'memories_pkey') {
          await this.runtime.emitEvent('DISCORD_RESPONSE', {
            type: 'REPLY',
            content:
              '⚠️ This check-in schedule has already been submitted. You can either:\n• Create a new check-in schedule with different settings\n• Update the existing schedule',
            ephemeral: true,
            interaction,
          });
        } else {
          await this.runtime.emitEvent('DISCORD_RESPONSE', {
            type: 'REPLY',
            content: 'Failed to save check-in schedule. Please try again.',
            ephemeral: true,
            interaction,
          });
        }
      } catch (replyError: unknown) {
        const replyErr = replyError as Error;
        logger.error('Failed to send error message:', replyErr);
      }
    }
  }

  private async storeCheckInSchedule(roomId: string, schedule: ExtendedCheckInSchedule): Promise<void> {
    try {
      // First create the room if it doesn't exist
      await this.runtime.ensureRoomExists({
        id: roomId as UUID,
        name: 'Check-in Schedules',
        source: 'team-coordinator',
        type: ChannelType.GROUP,
        worldId: this.runtime.agentId,
      });

      const timestamp = Date.now();
      const memory = {
        id: createUniqueUuid(this.runtime, `checkin-schedule-${schedule.scheduleId}-${timestamp}`),
        entityId: this.runtime.agentId,
        agentId: this.runtime.agentId,
        content: {
          type: 'team-member-checkin-schedule',
          schedule,
        },
        roomId: roomId as UUID,
        createdAt: timestamp,
      };

      logger.info('Storing check-in schedule in memory:', memory);
      await this.runtime.createMemory(memory, 'messages');
      logger.info('Successfully stored check-in schedule in memory');
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Failed to store check-in schedule:', err);
      throw error;
    }
  }

  // New methods for handling report channel configuration
  private async handleReportChannelSubmission(interaction: ExtendedInteraction) {
    try {
      logger.info('=== HANDLING REPORT CHANNEL SUBMISSION ===');
      logger.info('Full interaction object:', JSON.stringify(interaction, null, 2));

      // Parse server info from form data
      let serverInfo: { serverId?: string; serverName?: string } = {};
      try {
        if (interaction.selections?.server_info?.[0]) {
          serverInfo = JSON.parse(interaction.selections.server_info[0]);
          logger.info('Parsed server info:', serverInfo);
        }
      } catch (parseError: unknown) {
        const err = parseError as Error;
        logger.error('Error parsing server info:', err);
      }

      const selections = interaction.selections;
      logger.info('Form selections:', selections);

      if (!selections?.report_channel?.[0]) {
        logger.warn('Missing report channel selection');
        logger.warn('Server ID:', serverInfo?.serverId);
        logger.warn('Report channel selection:', selections?.report_channel);
        return;
      }

      const config: ReportChannelConfig = {
        serverId: serverInfo?.serverId, // Now optional
        serverName: serverInfo?.serverName || 'Unknown Server',
        channelId: selections.report_channel[0],
        createdAt: new Date().toISOString(),
      };

      await this.storeReportChannelConfig(config);
      logger.info(`Report channel configured for server ${serverInfo?.serverId}:`, config);

      await this.runtime.emitEvent('DISCORD_RESPONSE', {
        type: 'REPLY',
        content: '✅ Report channel has been configured successfully!',
        ephemeral: true,
        interaction,
      });
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Error in handleReportChannelSubmission:', err);
      logger.error('Error stack:', err.stack);
    }
  }

  private async storeReportChannelConfig(config: ReportChannelConfig): Promise<void> {
    try {
      const roomId = createUniqueUuid(this.runtime, 'report-channel-config');

      await this.runtime.ensureRoomExists({
        id: roomId as UUID,
        name: 'Report Channel Configurations',
        source: 'team-coordinator',
        type: ChannelType.GROUP,
        worldId: this.runtime.agentId,
      });

      const memory = {
        id: createUniqueUuid(this.runtime, `report-channel-config'}`),
        entityId: this.runtime.agentId,
        agentId: this.runtime.agentId,
        content: {
          type: 'report-channel-config',
          config,
        },
        roomId: roomId as UUID,
        createdAt: Date.now(),
      };

      await this.runtime.createMemory(memory, 'messages');
      if (config.serverId) {
        this.reportChannelConfigs.set(config.serverId, config);
      }
      logger.info('Successfully stored report channel config');
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Failed to store report channel config:', err);
      throw error;
    }
  }

  private async loadReportChannelConfigs(): Promise<void> {
    try {
      const roomId = createUniqueUuid(this.runtime, 'report-channel-config');
      
      // Ensure the room exists before trying to access it
      await this.runtime.ensureRoomExists({
        id: roomId as UUID,
        name: 'Report Channel Configurations',
        source: 'team-coordinator',
        type: ChannelType.GROUP,
        worldId: this.runtime.agentId,
      });
      
      const memories = await this.runtime.getMemories({
        roomId: roomId as UUID,
        tableName: 'messages',
      });

      for (const memory of memories) {
        if (memory.content.type === 'report-channel-config') {
          const config = memory.content.config as ReportChannelConfig;
          if (config.serverId) {
            this.reportChannelConfigs.set(config.serverId, config);
            logger.info(`Loaded report channel config for server ${config.serverId}`);
          }
        }
      }
    } catch (error: unknown) {
      const err = error as Error;
      logger.error('Error loading report channel configs:', err);
    }
  }

  // Helper method to get report channel for a server
  public getReportChannel(serverId: string): string | undefined {
    const config = this.reportChannelConfigs.get(serverId);
    return config?.channelId;
  }
}
