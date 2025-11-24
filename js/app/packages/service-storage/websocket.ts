import { SERVER_HOSTS } from '@core/constant/servers';
import {
  ConstantBackoff,
  type Websocket,
  WebsocketBuilder,
  WebsocketEvent,
} from '@websocket';
import { createWebsocketStateSignal } from '@websocket/solid/state-signal';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';

/**
 * The interval in milliseconds to send a heartbeat message to the server.
 * We set this to 5 minutes (API Gateway has a 10 minute idle timeout, this will also keep the lambda warm).
 */
const HEARTBEAT_INTERVAL = 300000;

/**
 * The time in milliseconds to wait for a heartbeat response from the server after the heartbeat is sent.
 */
const HEARTBEAT_TIMEOUT = 5000;

export const ws = new WebsocketBuilder(SERVER_HOSTS['websocket-service'])
  .withBackoff(new ConstantBackoff(1500))
  .withHeartbeat({
    pingMessage: JSON.stringify({ action: 'wsping' }),
    pongMessage: 'pong',
    timeout: HEARTBEAT_TIMEOUT,
    interval: HEARTBEAT_INTERVAL,
    maxMissedHeartbeats: 3,
  })
  .build();

export const storageWS = ws;

export const state = createWebsocketStateSignal(ws);

type WebSocketJobConfig<T, R, D, U> = {
  // websocket request data
  data: D;
  // name of the websocket action
  action: string;
  // processes the websocket response data of type U into a result of type T
  processResult: (data: U, jobId: string) => Promise<T | undefined>;
  // handles a successful result of type T and returns a promise of type R
  handleSuccess: (result: T) => Promise<R>;
};

export function createWebSocketJob<T, R, D, U>({
  data,
  action,
  processResult,
  handleSuccess,
}: WebSocketJobConfig<T, R, D, U>): Promise<R> {
  return new Promise((resolve, reject) => {
    const [jobId, setJobId] = createSignal<string | null>(null);
    const [failed, setFailed] = createSignal(false);
    const [result, setResult] = createSignal<T>();
    const requestId = uuidv7();

    // TODO: use zod types
    const messageHandler = async (
      _instance: Websocket,
      event: MessageEvent
    ) => {
      if (event.data === 'pong') return;
      const eventMessage = JSON.parse(event.data);

      // not our request
      if (
        !eventMessage.macroRequestId ||
        eventMessage.macroRequestId !== requestId
      )
        return;

      const isError =
        eventMessage.status === 'Error' || eventMessage.data.error;
      if (isError) {
        console.error(`${action} error`, eventMessage);
        setFailed(true);
        return;
      }

      // no data is available, job is not done yet
      if (!eventMessage.data?.data) {
        return;
      }

      const data = eventMessage.data.data;

      const processedResult = await processResult(data, eventMessage.jobId);
      if (processedResult === undefined) {
        console.error(`${action} error: Result is undefined`, eventMessage);
        setFailed(true);
        return;
      }

      setResult(() => processedResult);
      setJobId(eventMessage.jobId);
    };

    storageWS.addEventListener(WebsocketEvent.Message, messageHandler);
    storageWS.send(
      JSON.stringify({
        requestId,
        action,
        data,
      })
    );

    createEffect(() => {
      const completedJobId = jobId();
      const jobFailed = failed();
      if (completedJobId) {
        storageWS.removeEventListener(WebsocketEvent.Message, messageHandler);

        const currentResult = result();
        if (!currentResult) {
          console.error('Result is undefined');
          reject();
          return;
        }

        handleSuccess(currentResult).then(resolve).catch(reject);
        return;
      }

      if (jobFailed) {
        storageWS.removeEventListener(WebsocketEvent.Message, messageHandler);
        reject();
      }
    });

    onCleanup(() => {
      storageWS.removeEventListener(WebsocketEvent.Message, messageHandler);
    });
  });
}
