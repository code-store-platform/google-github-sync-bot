import { App } from '@slack/bolt';
import { CronJob } from 'cron';
import * as dotenv from 'dotenv';
import { envVars } from './lib/config.js';
import { WorkspaceGitHubSync } from './services/github-sync.js';
import { WorkspaceAtlassianSync } from './services/atlassian-sync.js';
import {
  formatMessages,
  formatAtlassianSyncMessages,
  formatAtlassianInactivityMessages,
} from './services/slack-notifier.js';

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
  console.debug('Received /sync-github command');
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
  console.debug('Received /sync-atlassian command');
  await ack();

  try {
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
  console.debug('Received /check-atlassian-3m command');
  await ack();

  try {
    const results = await atlassianSync.check3MonthInactivity();
    const dryRun = envVars.ATLASSIAN_DRY_RUN;

    if (
      (!results.suspended || results.suspended.length === 0) &&
      results.errors.length === 0
    ) {
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
  console.debug('Received /check-atlassian-6m command');
  await ack();

  try {
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
  const results = await sync.syncMembers();
  const users = await slackApp.client.users.conversations({
    exclude_archived: true,
    types: 'im',
  });

  if (
    users.ok &&
    users.channels?.length &&
    users.channels.length > 1 &&
    (results.invited.length > 0 || results.removed.length > 0 || results.errors.length > 0)
  ) {
    const userString = users
      .channels!.filter((channel) => channel.user !== 'USLACKBOT')
      .map((channel) => channel.user)
      .join(',');
    const conversation = await slackApp.client.conversations.open({
      users: userString,
    });
    const channelId = conversation.channel?.id || '';
    const msg = formatMessages(results);
    await slackApp.client.chat.postMessage({
      token: envVars.SLACK_BOT_TOKEN,
      channel: channelId,
      text: 'GitHub Synchronization results',
      blocks: msg.blocks,
    });
  }
}

async function syncAtlassianPeriodically() {
  const results = await atlassianSync.syncSuspensions();
  const dryRun = envVars.ATLASSIAN_DRY_RUN;
  const users = await slackApp.client.users.conversations({
    exclude_archived: true,
    types: 'im',
  });

  if (
    users.ok &&
    users.channels?.length &&
    users.channels.length > 1 &&
    (results.suspended.length > 0 || results.errors.length > 0)
  ) {
    const userString = users
      .channels!.filter((channel) => channel.user !== 'USLACKBOT')
      .map((channel) => channel.user)
      .join(',');
    const conversation = await slackApp.client.conversations.open({
      users: userString,
    });
    const channelId = conversation.channel?.id || '';
    const msg = formatAtlassianSyncMessages(results, dryRun);
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

async function check3MonthInactivityPeriodically() {
  const results = await atlassianSync.check3MonthInactivity();
  const dryRun = envVars.ATLASSIAN_DRY_RUN;
  const users = await slackApp.client.users.conversations({
    exclude_archived: true,
    types: 'im',
  });

  if (
    users.ok &&
    users.channels?.length &&
    users.channels.length > 1 &&
    ((results.suspended && results.suspended.length > 0) || results.errors.length > 0)
  ) {
    const userString = users
      .channels!.filter((channel) => channel.user !== 'USLACKBOT')
      .map((channel) => channel.user)
      .join(',');
    const conversation = await slackApp.client.conversations.open({
      users: userString,
    });
    const channelId = conversation.channel?.id || '';
    const msg = formatAtlassianInactivityMessages(results, dryRun);
    await slackApp.client.chat.postMessage({
      token: envVars.SLACK_BOT_TOKEN,
      channel: channelId,
      text: dryRun
        ? '[DRY RUN] Atlassian 3-month inactivity check results'
        : 'Atlassian 3-month inactivity check results',
      blocks: msg.blocks,
    });
  }
}

async function check6MonthInactivityPeriodically() {
  const results = await atlassianSync.check6MonthInactivity();
  const dryRun = envVars.ATLASSIAN_DRY_RUN;
  const users = await slackApp.client.users.conversations({
    exclude_archived: true,
    types: 'im',
  });

  if (
    users.ok &&
    users.channels?.length &&
    users.channels.length > 1 &&
    ((results.deleted && results.deleted.length > 0) || results.errors.length > 0)
  ) {
    const userString = users
      .channels!.filter((channel) => channel.user !== 'USLACKBOT')
      .map((channel) => channel.user)
      .join(',');
    const conversation = await slackApp.client.conversations.open({
      users: userString,
    });
    const channelId = conversation.channel?.id || '';
    const msg = formatAtlassianInactivityMessages(results, dryRun);
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

await slackApp.start(envVars.PORT);
console.log('⚡️ Slack bot is running!');

const githubCronJob = new CronJob(envVars.CRON_SCHEDULE, syncPeriodically, null, true);
githubCronJob.start();

const atlassianSyncCronJob = new CronJob(
  envVars.CRON_SCHEDULE,
  syncAtlassianPeriodically,
  null,
  true,
);
atlassianSyncCronJob.start();

const atlassian3mCronJob = new CronJob(
  envVars.ATLASSIAN_INACTIVITY_3M_SCHEDULE,
  check3MonthInactivityPeriodically,
  null,
  true,
);
atlassian3mCronJob.start();

const atlassian6mCronJob = new CronJob(
  envVars.ATLASSIAN_INACTIVITY_6M_SCHEDULE,
  check6MonthInactivityPeriodically,
  null,
  true,
);
atlassian6mCronJob.start();
