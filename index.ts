import { App } from '@slack/bolt';
import { CronJob } from 'cron';
import * as dotenv from 'dotenv';
import { envVars } from './lib/config';
import {
  type AtlassianInactivityResult,
  type AtlassianSyncResult,
  WorkspaceAtlassianSync,
} from './services/atlassian-sync';
import { type SyncResult, WorkspaceGitHubSync } from './services/github-sync';
import {
  formatAtlassianInactivityMessages,
  formatAtlassianSyncMessages,
  formatMessages,
} from './services/slack-notifier';

dotenv.config();

const slackApp = new App({
  signingSecret: envVars.SLACK_SIGNING_SECRET,
  token: envVars.SLACK_BOT_TOKEN,
  appToken: envVars.SLACK_APP_TOKEN,
  socketMode: true,
});

const sync = new WorkspaceGitHubSync();
const atlassianSync = new WorkspaceAtlassianSync();

slackApp.command('/sync-github', async ({ ack, respond }) => {
  await ack();

  try {
    const results = await sync.syncMembers();

    if (
      results.invited.length === 0 &&
      results.removed.length === 0 &&
      results.errors.length === 0
    ) {
      await respond('No changes detected');
    } else {
      const msg = formatMessages(results);
      await respond(msg);
    }
  } catch (error) {
    await respond('Error during sync');
    console.error('Error during sync', error);
  }
});

slackApp.command('/sync-atlassian', async ({ ack, respond }) => {
  await ack();

  try {
    // Clear cache for manual sync to ensure fresh data
    atlassianSync.clearCache();
    const results = await atlassianSync.syncSuspensions();
    const dryRun = envVars.ATLASSIAN_DRY_RUN;

    if (results.suspended.length === 0 && results.errors.length === 0) {
      await respond(dryRun ? '[DRY RUN] No changes detected' : 'No changes detected');
    } else {
      const msg = formatAtlassianSyncMessages(results, dryRun);
      await respond(msg);
    }
  } catch (error) {
    await respond('Error during Atlassian sync');
    console.error('Error during Atlassian sync', error);
  }
});

slackApp.command('/check-atlassian-3m', async ({ ack, respond }) => {
  await ack();

  try {
    // Clear cache for manual check to ensure fresh data
    atlassianSync.clearCache();
    const results = await atlassianSync.check3MonthInactivity();
    const dryRun = envVars.ATLASSIAN_DRY_RUN;

    if ((!results.suspended || results.suspended.length === 0) && results.errors.length === 0) {
      await respond(
        dryRun
          ? '[DRY RUN] No users found inactive for more than 3 months'
          : 'No users found inactive for more than 3 months',
      );
    } else {
      const msg = formatAtlassianInactivityMessages(results, dryRun);
      await respond(msg);
    }
  } catch (error) {
    await respond('Error during 3-month inactivity check');
    console.error('Error during 3-month inactivity check', error);
  }
});

slackApp.command('/check-atlassian-6m', async ({ ack, respond }) => {
  await ack();

  try {
    // Clear cache for manual check to ensure fresh data
    atlassianSync.clearCache();
    const results = await atlassianSync.check6MonthInactivity();
    const dryRun = envVars.ATLASSIAN_DRY_RUN;

    if ((!results.deleted || results.deleted.length === 0) && results.errors.length === 0) {
      await respond(
        dryRun
          ? '[DRY RUN] No users found inactive for more than 6 months'
          : 'No users found inactive for more than 6 months',
      );
    } else {
      const msg = formatAtlassianInactivityMessages(results, dryRun);
      await respond(msg);
    }
  } catch (error) {
    await respond('Error during 6-month inactivity check');
    console.error('Error during 6-month inactivity check', error);
  }
});

async function syncPeriodically() {
  const syncStartTime = new Date().toISOString();
  console.log(`[${syncStartTime}] Starting GitHub + Atlassian suspension periodic sync...`);

  // Run GitHub sync
  let githubResults: SyncResult = { invited: [], removed: [], errors: [] };
  try {
    githubResults = await sync.syncMembers();
  } catch (error) {
    console.error('Error during GitHub periodic sync:', error);
  }

  // Run Atlassian suspension sync (removes users who left Workspace)
  const dryRun = envVars.ATLASSIAN_DRY_RUN;
  let suspensionResults: AtlassianSyncResult = { suspended: [], errors: [] };
  try {
    suspensionResults = await atlassianSync.syncSuspensions();
  } catch (error) {
    console.error('Error in syncSuspensions:', error);
    suspensionResults.errors.push(
      `Failed to sync suspensions: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Send Slack notifications if there are changes
  try {
    const users = await slackApp.client.users.conversations({
      exclude_archived: true,
      types: 'im',
    });

    if (users.ok && users.channels?.length && users.channels.length > 1) {
      const userString =
        users.channels
          ?.filter((channel) => channel.user !== 'USLACKBOT')
          .map((channel) => channel.user)
          .join(',') ?? '';
      const conversation = await slackApp.client.conversations.open({
        users: userString,
      });
      const channelId = conversation.channel?.id || '';

      // Send GitHub sync notification if there are changes
      if (
        githubResults.invited.length > 0 ||
        githubResults.removed.length > 0 ||
        githubResults.errors.length > 0
      ) {
        const msg = formatMessages(githubResults);
        await slackApp.client.chat.postMessage({
          token: envVars.SLACK_BOT_TOKEN,
          channel: channelId,
          text: 'GitHub Synchronization results',
          blocks: msg.blocks,
        });
      }

      // Send Atlassian suspension notification if there are changes
      if (suspensionResults.suspended.length > 0 || suspensionResults.errors.length > 0) {
        const msg = formatAtlassianSyncMessages(suspensionResults, dryRun);
        await slackApp.client.chat.postMessage({
          token: envVars.SLACK_BOT_TOKEN,
          channel: channelId,
          text: dryRun
            ? '[DRY RUN] Atlassian Synchronization results'
            : 'Atlassian Synchronization results',
          blocks: msg.blocks,
        });
      }
    }
  } catch (error) {
    console.error('Error sending Slack notifications:', error);
  }

  const syncEndTime = new Date().toISOString();
  console.log(`[${syncEndTime}] GitHub + Atlassian suspension periodic sync completed`);
}

async function suspendAtlassianUsersPeriodically() {
  const syncStartTime = new Date().toISOString();
  console.log(`[${syncStartTime}] Starting Atlassian inactivity periodic check...`);

  const dryRun = envVars.ATLASSIAN_DRY_RUN;

  let inactivity3mResults: AtlassianInactivityResult = { suspended: [], errors: [] };
  const inactivity6mResults: AtlassianInactivityResult = { deleted: [], errors: [] };

  try {
    inactivity3mResults = await atlassianSync.check3MonthInactivity();
  } catch (error) {
    console.error('Error in check3MonthInactivity:', error);
    inactivity3mResults.errors.push(
      `Failed to check 3-month inactivity: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // try {
  //   inactivity6mResults = await atlassianSync.check6MonthInactivity();
  // } catch (error) {
  //   console.error('Error in check6MonthInactivity:', error);
  //   inactivity6mResults.errors.push(
  //     `Failed to check 6-month inactivity: ${error instanceof Error ? error.message : String(error)}`,
  //   );
  // }

  // Send Slack notifications if there are changes
  try {
    const users = await slackApp.client.users.conversations({
      exclude_archived: true,
      types: 'im',
    });

    if (
      users.ok &&
      users.channels?.length &&
      users.channels.length > 1 &&
      ((inactivity3mResults.suspended && inactivity3mResults.suspended.length > 0) ||
        inactivity3mResults.errors.length > 0 ||
        (inactivity6mResults.deleted && inactivity6mResults.deleted.length > 0) ||
        inactivity6mResults.errors.length > 0)
    ) {
      const userString =
        users.channels
          ?.filter((channel) => channel.user !== 'USLACKBOT')
          .map((channel) => channel.user)
          .join(',') ?? '';
      const conversation = await slackApp.client.conversations.open({
        users: userString,
      });
      const channelId = conversation.channel?.id || '';

      // Send 3-month inactivity notification if there are changes
      if (
        (inactivity3mResults.suspended && inactivity3mResults.suspended.length > 0) ||
        inactivity3mResults.errors.length > 0
      ) {
        const msg = formatAtlassianInactivityMessages(inactivity3mResults, dryRun);
        await slackApp.client.chat.postMessage({
          token: envVars.SLACK_BOT_TOKEN,
          channel: channelId,
          text: dryRun
            ? '[DRY RUN] Atlassian 3-month inactivity check results'
            : 'Atlassian 3-month inactivity check results',
          blocks: msg.blocks,
        });
      }

      // Send 6-month deletion notification if there are changes
      if (
        (inactivity6mResults.deleted && inactivity6mResults.deleted.length > 0) ||
        inactivity6mResults.errors.length > 0
      ) {
        const msg = formatAtlassianInactivityMessages(inactivity6mResults, dryRun);
        await slackApp.client.chat.postMessage({
          token: envVars.SLACK_BOT_TOKEN,
          channel: channelId,
          text: dryRun
            ? '[DRY RUN] Atlassian 6-month inactivity check results'
            : 'Atlassian 6-month inactivity check results',
          blocks: msg.blocks,
        });
      }
    }
  } catch (error) {
    console.error('Error sending Slack notifications:', error);
  }

  const syncEndTime = new Date().toISOString();
  console.log(`[${syncEndTime}] Atlassian inactivity periodic check completed`);
}

await slackApp.start(envVars.PORT);
console.log('⚡️ Slack bot is running!');

// Start CRON jobs - fourth parameter 'false' means don't run immediately, only on schedule
const githubCronJob = new CronJob(envVars.CRON_SCHEDULE, syncPeriodically, null, false);
githubCronJob.start();

const atlassianCronJob = new CronJob(
  envVars.ATLASSIAN_INACTIVITY_CRON_SCHEDULE,
  suspendAtlassianUsersPeriodically,
  null,
  false,
);
atlassianCronJob.start();
