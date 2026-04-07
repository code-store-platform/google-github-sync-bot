import type { SlackBlock } from './slack-notification';
import type { SyncResult } from './sync-engine';
import { envVars } from '../lib/config';

export function formatGitHubSyncMessage(results: SyncResult): {
  text: string;
  blocks: SlackBlock[];
} {
  const gitHubOrgName = envVars.GITHUB_ORG_NAME;
  const blocks: SlackBlock[] = [];

  if (results.invited.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*Invited users:*\n' +
          results.invited
            .map(
              ({ username, email }) =>
                `* <https://github.com/orgs/${gitHubOrgName}/people/${username}|${username}> \u2013 ${email}`,
            )
            .join('\n'),
      },
    });
  }

  if (results.removed.length > 0) {
    blocks.push({
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
    });
  }

  if (results.errors.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Errors:*\n${results.errors.map((msg) => `* ${msg}`).join('\n')}`,
      },
    });
  }

  return {
    text: 'GitHub Sync completed',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'GitHub Sync Results',
        },
      },
      ...blocks,
      { type: 'divider' },
    ],
  };
}
