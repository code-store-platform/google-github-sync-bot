# Google-GitHub Sync

A tool to synchronize Google Workspace users with GitHub organization members based on their GitHub usernames.

## Features

- Automatically invites Google Workspace users who have GitHub usernames to a GitHub organization
- Removes users from the GitHub organization if they're not in Google Workspace
- Provides a Slack bot with commands to trigger synchronization manually
- Runs scheduled synchronization via cron jobs
- Posts notifications about sync results to Slack

## Installation

 1. Clone the repository
 2. Install dependencies:
```shell
bun install
```

## Configuration

Create a .env file with the following variables:
```dotenv
GOOGLE_APPLICATION_CREDENTIALS='{ service account credentials JSON }'
GOOGLE_ADMIN_EMAIL=admin@example.com

GITHUB_TOKEN=your_github_personal_access_token
GITHUB_ORG_NAME=your-org-name

SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
SLACK_APP_TOKEN=xapp-your-slack-app-token

REMOVE_STOP_LIST=user1,user2

CRON_SCHEDULE='* */15 * * * *'
```

## Requirements

- Google Workspace account with Admin SDK API enabled
- GitHub account with admin permissions on the organization
- Slack workspace with a bot app installed

## Usage

Running the application:
```shell
bun run index.ts
```

Or using Docker:
```shell
docker build -t google-github-sync .
docker run -d google-github-sync
```

### Slack Commands
/sync-github - Manually trigger synchronization between Google Workspace and GitHub
