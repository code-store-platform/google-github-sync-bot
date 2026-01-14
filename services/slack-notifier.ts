import { envVars } from '../lib/config';
import type { SyncResult } from './github-sync';
import type { AtlassianSyncResult, AtlassianInactivityResult } from './atlassian-sync';

/**
 * Chunks an array of items into groups where each group's text length doesn't exceed maxLength.
 * @param items - Array of items to chunk
 * @param formatter - Function to format each item into text
 * @param maxLength - Maximum length for each chunk's text (default 2800 to leave room for headers)
 */
function chunkItems<T>(items: T[], formatter: (item: T) => string, maxLength = 2800): string[][] {
  const chunks: T[][] = [];
  let currentChunk: T[] = [];
  let currentLength = 0;

  for (const item of items) {
    const itemText = formatter(item);
    const itemLength = itemText.length + 1; // +1 for newline

    if (currentLength + itemLength > maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [item];
      currentLength = itemLength;
    } else {
      currentChunk.push(item);
      currentLength += itemLength;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks.map((chunk) => chunk.map(formatter));
}

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

type SlackBlock = {
  type: string;
  text?: {
    type: string;
    text: string;
  };
};

export function formatAtlassianSyncMessages(results: AtlassianSyncResult, dryRun = false) {
  const blocks: SlackBlock[] = [];

  // Chunk suspended users if list is too long
  if (results.suspended.length > 0) {
    const formatter = ({ email, accountId }: { email: string; accountId: string }) =>
      `• ${email} (account: ${accountId.substring(0, 8)}...)`;

    const chunks = chunkItems(results.suspended, formatter);

    chunks.forEach((chunk, index) => {
      const prefix = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suspended users (removed from Workspace)${prefix}:*\n${chunk.join('\n')}`,
        },
      });
    });
  }

  // Chunk errors if list is too long
  if (results.errors.length > 0) {
    const formatter = (msg: string) => `• ${msg}`;
    const chunks = chunkItems(results.errors, formatter);

    chunks.forEach((chunk, index) => {
      const prefix = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Errors${prefix}:*\n${chunk.join('\n')}`,
        },
      });
    });
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
  const blocks: SlackBlock[] = [];

  // Chunk suspended users if list is too long
  if (results.suspended && results.suspended.length > 0) {
    const formatter = ({
      email,
      lastActiveDate,
      inactiveDays,
    }: {
      email: string;
      lastActiveDate?: string;
      inactiveDays?: number;
    }) =>
      `• ${email} - Last active: ${lastActiveDate ? new Date(lastActiveDate).toISOString().split('T')[0] : 'unknown'} (${inactiveDays} days ago)`;

    const chunks = chunkItems(results.suspended, formatter);

    chunks.forEach((chunk, index) => {
      const prefix = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suspended users (inactive >90 days)${prefix}:*\n${chunk.join('\n')}`,
        },
      });
    });
  }

  // Chunk deleted users if list is too long
  if (results.deleted && results.deleted.length > 0) {
    const formatter = ({
      email,
      lastActiveDate,
      inactiveDays,
    }: {
      email: string;
      lastActiveDate?: string;
      inactiveDays?: number;
    }) =>
      `• *${email}* - Last active: ${lastActiveDate ? new Date(lastActiveDate).toISOString().split('T')[0] : 'unknown'} (${inactiveDays} days ago) [14-day grace period]`;

    const chunks = chunkItems(results.deleted, formatter);

    chunks.forEach((chunk, index) => {
      const prefix = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Deleted users (inactive >180 days)${prefix}:*\n${chunk.join('\n')}`,
        },
      });
    });
  }

  // Chunk errors if list is too long
  if (results.errors.length > 0) {
    const formatter = (msg: string) => `• ${msg}`;
    const chunks = chunkItems(results.errors, formatter);

    chunks.forEach((chunk, index) => {
      const prefix = chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Errors${prefix}:*\n${chunk.join('\n')}`,
        },
      });
    });
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
