import { throwOnErr } from '@core/util/result';
import { uploadFile } from '@core/util/upload';
import { storageServiceClient } from '@service-storage/client';
import { match } from 'ts-pattern';
import type { WorkspaceTarget } from '../primitives/workspace-archive';

/** Restores into the signed-in user's workspace, private to them. */
export const workspaceTarget: WorkspaceTarget = {
  async createProject(name, parentId) {
    const project = await throwOnErr(() =>
      storageServiceClient.projects.create({
        name,
        projectParentId: parentId,
      })
    );
    return project.id;
  },

  async createMarkdown({ kind, name, projectId, markdown }) {
    await match(kind)
      .with('note', () =>
        throwOnErr(() =>
          storageServiceClient.createMarkdownDocument({
            documentName: name,
            markdown,
            projectId,
            skipHistory: true,
          })
        )
      )
      .with('task', () =>
        throwOnErr(() =>
          storageServiceClient.createTask({
            taskName: name,
            markdown,
            projectId,
            shareWithTeam: false,
          })
        )
      )
      .with('snippet', () =>
        throwOnErr(() =>
          storageServiceClient.createSnippet({
            snippetName: name,
            markdown,
            projectId,
          })
        )
      )
      .with('skill', () =>
        throwOnErr(() =>
          storageServiceClient.createSkill({
            skillName: name,
            markdown,
            projectId,
          })
        )
      )
      .exhaustive((unknown) => {
        throw new Error(`Unknown document kind: ${String(unknown)}`);
      });
  },

  async upload({ fileName, projectId, bytes }) {
    const result = await uploadFile(
      new File([new Uint8Array(bytes)], fileName),
      'dss',
      {
        projectId,
        hideProgressIndicator: true,
        skipAnalytics: true,
        // Processing finishes on the server; the import needn't wait for it.
        skipWaitForDocxProcessing: true,
      }
    );
    if (result.failed) throw result.error;
  },
};
