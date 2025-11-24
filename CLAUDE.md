# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Google-GitHub Sync is a tool that synchronizes Google Workspace users with GitHub organization members. It automatically invites users with GitHub usernames to a GitHub organization and removes users who are no longer in Google Workspace. The tool provides both a Slack bot interface for manual triggers and scheduled synchronization via cron jobs.

## Development Commands

**Install dependencies:**
```bash
bun install
```

**Run the application:**
```bash
bun run index.ts
```

**Format code:**
```bash
bunx prettier --write .
```

**Docker commands:**
```bash
docker build -t google-github-sync .
docker run -d google-github-sync
```

## Architecture

This is a single-file TypeScript application (`index.ts`) that runs continuously with three main components:

1. **WorkspaceGitHubSync class**: Core synchronization logic
   - Fetches Google Workspace users via Google Admin SDK API
   - Manages GitHub organization membership via Octokit
   - Handles invitations and removals based on custom schema field `3rd-party_tools.GitHub_Username`

2. **Slack Bot**: Built with @slack/bolt using Socket Mode
   - Listens for `/sync-github` slash command for manual sync triggers
   - Posts formatted sync results with user links and email addresses

3. **Cron Job**: Scheduled synchronization
   - Uses `cron` package with configurable schedule
   - Automatically notifies Slack DM group when changes occur
   - Only sends notifications when there are actual changes (invites, removals, or errors)

## Key Technical Details

**Google Workspace Integration:**
- Uses service account credentials with domain-wide delegation
- Requires `admin.directory.user.readonly` scope
- Impersonates admin user via `subject` field
- Fetches up to 300 users with custom schema projection
- GitHub usernames are stored in `customSchemas['3rd-party_tools'].GitHub_Username`

**GitHub Integration:**
- Uses Octokit with personal access token
- Requires organization admin permissions
- Uses pagination for listing members and pending invitations
- Invites users by `invitee_id` (not by email)
- All username comparisons are case-insensitive via `.toLowerCase()`

**Remove Stop List:**
- Environment variable `REMOVE_STOP_LIST` contains comma-separated usernames
- These users will never be removed from GitHub org, even if not in Workspace
- Useful for bot accounts or external collaborators

**Sync Logic:**
1. Fetch all Google Workspace users with full projection
2. Fetch current GitHub org members and pending invitations
3. Filter Workspace users who have GitHub usernames in custom schema
4. Invite users not currently in org or pending (looks up GitHub user by username first)
5. Remove members not in Workspace and not in stop list
6. Return structured results with invited users (with emails), removed usernames, and errors

**Cron Notifications:**
- `syncPeriodically()` creates a multi-user DM channel with all bot conversations
- Only sends notification if there are changes AND multiple users exist
- Filters out USLACKBOT from recipient list
- Uses `conversations.open()` with multiple user IDs to create/find group DM

## Environment Configuration

Required environment variables in `.env`:
- `GOOGLE_APPLICATION_CREDENTIALS`: JSON string of service account credentials
- `GOOGLE_ADMIN_EMAIL`: Admin email to impersonate
- `GITHUB_TOKEN`: GitHub personal access token with org admin permissions
- `GITHUB_ORG_NAME`: GitHub organization name
- `SLACK_BOT_TOKEN`: Bot user OAuth token (xoxb-)
- `SLACK_SIGNING_SECRET`: Slack app signing secret
- `SLACK_APP_TOKEN`: App-level token for Socket Mode (xapp-)
- `REMOVE_STOP_LIST`: Comma-separated GitHub usernames to never remove
- `CRON_SCHEDULE`: Cron schedule string (defaults to midnight daily)
- `PORT`: Optional port for Slack app (defaults to 3000)

## Runtime

- Built for Bun runtime (not Node.js)
- Uses TypeScript with strict mode enabled
- No build step required (noEmit: true in tsconfig)
- Runs as long-lived process with Slack Socket Mode and cron job