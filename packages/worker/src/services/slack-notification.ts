import { Context, Effect, Layer } from 'effect';
import { WebClient } from '@slack/web-api';
import { SlackError } from '../lib/errors';
import { envVars } from '../lib/config';

export type SlackBlock = {
  type: string;
  text?: {
    type: string;
    text: string;
  };
};

export class SlackNotificationService extends Context.Tag('SlackNotificationService')<
  SlackNotificationService,
  {
    readonly sendNotification: (params: {
      channel: string;
      text: string;
      blocks: SlackBlock[];
    }) => Effect.Effect<void, SlackError>;
    readonly isEnabled: boolean;
  }
>() {}

export const SlackNotificationServiceLive = Layer.sync(SlackNotificationService, () => {
  const token = envVars.SLACK_BOT_TOKEN;
  const client = token ? new WebClient(token) : null;

  return {
    isEnabled: !!client,

    sendNotification: (params) =>
      client
        ? Effect.tryPromise({
            try: async () => {
              await client.chat.postMessage({
                channel: params.channel,
                text: params.text,
                blocks: params.blocks,
              });
            },
            catch: (e) => new SlackError({ message: `Failed to send notification: ${e}` }),
          })
        : Effect.void,
  };
});
