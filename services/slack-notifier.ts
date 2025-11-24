import type { SyncResult } from './github-sync.js';

export function formatMessages(results: SyncResult) {
  const gitHubOrgName = process.env.GITHUB_ORG_NAME;
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
