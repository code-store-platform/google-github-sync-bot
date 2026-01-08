import { envVars } from '../lib/config.ts';
import type { SyncResult } from './github-sync.js';
import type { AtlassianSyncResult, AtlassianInactivityResult } from './atlassian-sync.js';

export function formatMessages(results: SyncResult) {
  const gitHubOrgName = envVars.GITHUB_ORG_NAME;
  const invitedMessageBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        '*Invited users:*\n' +
        results.invited
          .map(
            ({ username, email }) =>
              `* <https://github.com/orgs/${gitHubOrgName}/people/${username}|${username}> – ${email}`,
          )
          .join('\n'),
    },
  };
  const removedMessageBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        '*Removed users:*\n' +
        results.removed
          .map(
            (username) =>
              `* <https://github.com/orgs/${gitHubOrgName}/people/${username}|${username}>`,
          )
          .join('\n'),
    },
  };
  const errorsMessageBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Errors:*\n${results.errors.map((msg) => `* ${msg}`).join('\n')}`,
    },
  };

  const blocks = [];
  if (results.invited.length > 0) {
    blocks.push(invitedMessageBlock);
  }
  if (results.removed.length > 0) {
    blocks.push(removedMessageBlock);
  }
  if (results.errors.length > 0) {
    blocks.push(errorsMessageBlock);
  }

  return {
    text: 'Sync completed! Here are the results:',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Sync results',
        },
      },
      ...blocks,
      {
        type: 'divider',
      },
    ],
  };
}

export function formatAtlassianSyncMessages(results: AtlassianSyncResult, dryRun = false) {
  const suspendedMessageBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        '*Suspended users (removed from Workspace):*\n' +
        results.suspended
          .map(({ email, accountId }) => `• ${email} (account: ${accountId.substring(0, 8)}...)`)
          .join('\n'),
    },
  };

  const errorsMessageBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Errors:*\n${results.errors.map((msg) => `• ${msg}`).join('\n')}`,
    },
  };

  const blocks = [];
  if (results.suspended.length > 0) {
    blocks.push(suspendedMessageBlock);
  }
  if (results.errors.length > 0) {
    blocks.push(errorsMessageBlock);
  }

  const headerText = dryRun ? 'Atlassian Sync Results [DRY RUN]' : 'Atlassian Sync Results';

  return {
    text: dryRun
      ? '[DRY RUN] Atlassian sync completed!'
      : 'Atlassian sync completed! Here are the results:',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: headerText,
        },
      },
      ...blocks,
      {
        type: 'divider',
      },
    ],
  };
}

export function formatAtlassianInactivityMessages(
  results: AtlassianInactivityResult,
  dryRun = false,
) {
  const suspendedMessageBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        '*Suspended users (inactive >90 days):*\n' +
        (results.suspended || [])
          .map(
            ({ email, lastActiveDate, inactiveDays }) =>
              `• ${email} - Last active: ${lastActiveDate ? new Date(lastActiveDate).toISOString().split('T')[0] : 'unknown'} (${inactiveDays} days ago)`,
          )
          .join('\n'),
    },
  };

  const deletedMessageBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        '*Deleted users (inactive >180 days):*\n' +
        (results.deleted || [])
          .map(
            ({ email, lastActiveDate, inactiveDays }) =>
              `• *${email}* - Last active: ${lastActiveDate ? new Date(lastActiveDate).toISOString().split('T')[0] : 'unknown'} (${inactiveDays} days ago) [14-day grace period]`,
          )
          .join('\n'),
    },
  };

  const errorsMessageBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Errors:*\n${results.errors.map((msg) => `• ${msg}`).join('\n')}`,
    },
  };

  const blocks = [];
  if (results.suspended && results.suspended.length > 0) {
    blocks.push(suspendedMessageBlock);
  }
  if (results.deleted && results.deleted.length > 0) {
    blocks.push(deletedMessageBlock);
  }
  if (results.errors.length > 0) {
    blocks.push(errorsMessageBlock);
  }

  // Determine the header text based on what was done
  const baseHeaderText =
    results.suspended && results.suspended.length > 0
      ? 'Atlassian 3-Month Inactivity Check'
      : 'Atlassian 6-Month Inactivity Check';

  const headerText = dryRun ? `${baseHeaderText} [DRY RUN]` : baseHeaderText;

  return {
    text: dryRun
      ? '[DRY RUN] Atlassian inactivity check completed!'
      : 'Atlassian inactivity check completed!',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: headerText,
        },
      },
      ...blocks,
      {
        type: 'divider',
      },
    ],
  };
}
