import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const storePath = fileURLToPath(
  new URL('../../../queries/email/local-draft-store.ts', import.meta.url)
);
const wasmPath = fileURLToPath(new URL('../wasm-module.ts', import.meta.url));

test('independent send authority survives actual WASM physical cache recovery', async ({
  page,
}) => {
  await page.goto(`/email-send.html?scope=independent-${crypto.randomUUID()}`);
  const result = await page.evaluate(
    async ({ storePath, wasmPath }) => {
      const {
        createLocalDraftStore,
      }: typeof import('../../../queries/email/local-draft-store') =
        await import(`${location.origin}/@fs${storePath}`);
      const store = createLocalDraftStore(
        'audit-independent-' + crypto.randomUUID()
      );
      const owner = await store.activate('audit');
      const uuid = crypto.randomUUID();
      await store.save(owner, {
        key: 'draft',
        accountId: 'audit',
        generation: 'generation',
        draftId: 'draft',
        threadId: 'thread',
        expectedRevision: 0,
        content: { subject: 'AUDIT cache reset', body_text: 'Approved body' },
        attachments: [],
        status: 'dirty',
      });
      const intent: import('../../../queries/email/send-queue').EmailSendIntent =
        {
          uuid,
          phase: 'pending',
          locallyCancelled: false,
          metadata: {
            kind: 'email-send-v1',
            payload: {
              input: {
                attempt: { attemptId: uuid, linkId: 'inbox' },
                message: {
                  draftId: 'draft',
                  subject: 'AUDIT cache reset',
                  bodyText: 'Approved body',
                },
                attachmentIds: [],
                forwardedAttachmentIds: [],
              },
              draft: {
                draftId: 'draft',
                threadDbId: 'thread',
                senderLinkId: 'inbox',
                senderEmail: 'audit@example.invalid',
                subject: 'AUDIT cache reset',
                bodyText: 'Approved body',
                optimisticBodyHtml: null,
              },
              workingCopy: {
                key: 'draft',
                generation: 'generation',
                revision: 1,
                attachments: [],
              },
            },
          },
        };
      await store.putSend(owner, intent, true);
      const workerSource = `import {loadCacheWasm} from ${JSON.stringify(`${location.origin}/@fs${wasmPath}`)};
try { const wasm=await loadCacheWasm(); const engine=await wasm.openCache('independent-cache-'+crypto.randomUUID()); const query='mutation SetEntityProperty($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { id displayName } }'; await engine.enqueueOptimisticMutation(undefined,${JSON.stringify(uuid)},query,'SetEntityProperty',{input:{entityId:'doc',value:{string:'Approved body'}}},{setEntityProperty:{id:'property',displayName:'Approved body'},__durableIntent:${JSON.stringify({ ...intent.metadata, deferInitialClaim: true })}},[],[],[],1,'audit',1,1000); const before=(await engine.durableMutationIntents()).length; await engine.physicalReset(); const after=(await engine.durableMutationIntents()).length; await engine.close(); postMessage({before,after}); } catch(e){postMessage({error:String(e)});}`;
      const worker = new Worker(
        URL.createObjectURL(
          new Blob([workerSource], { type: 'text/javascript' })
        ),
        { type: 'module' }
      );
      const cache = await new Promise<{
        before: number;
        after: number;
        error?: string;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('worker timeout')),
          60000
        );
        worker.onmessage = (e) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(e.data);
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(e.message));
        };
      });
      const recovered = (await store.sends(owner))[0];
      let locked = false;
      try {
        await store.save(owner, {
          key: 'draft',
          accountId: 'audit',
          generation: 'generation',
          draftId: 'draft',
          expectedRevision: 1,
          content: { subject: 'Late edit' },
          attachments: [],
          status: 'dirty',
        });
      } catch {
        locked = true;
      }
      await store.clear();
      await store.close();
      return {
        cache,
        backupCount: recovered ? 1 : 0,
        sameAttemptId: recovered?.uuid === uuid,
        body: recovered?.metadata.payload.input.message.bodyText,
        locked,
      };
    },
    { storePath, wasmPath }
  );
  expect(result).toEqual({
    cache: { before: 1, after: 0 },
    backupCount: 1,
    sameAttemptId: true,
    body: 'Approved body',
    locked: true,
  });
});
