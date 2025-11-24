import { App } from '@slack/bolt';
import { CronJob } from 'cron';
import * as dotenv from 'dotenv';
import { WorkspaceGitHubSync } from './services/github-sync.js';
import { formatMessages } from './services/slack-notifier.js';

dotenv.config();

const slackApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const sync = new WorkspaceGitHubSync();

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
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      text: 'GitHub Synchronization results',
      blocks: msg.blocks,
    });
  }
}

await slackApp.start(process.env.PORT || 3000);
console.log('⚡️ Slack bot is running!');

const cronJob = new CronJob(
  process.env.CRON_SCHEDULE || '0 0 0 * * *',
  syncPeriodically,
  null,
  true,
);
cronJob.start();
