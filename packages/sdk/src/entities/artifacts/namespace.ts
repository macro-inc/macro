import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Project } from '../projects/project';
import { Artifact } from './artifact';
import {
  type ArtifactFiles,
  type ArtifactSceneInput,
  inlineFiles,
  prepareBundle,
  sceneBodies,
} from './bundle';

/** Create an artifact with its first version. */
export interface CreateArtifactOptions {
  /** Name shown in Drive, search and the artifact's page. */
  name: string;
  /** Every file of version 1 by relative path; `index.html` is required. */
  files: ArtifactFiles;
  /** Named pages of version 1. */
  scenes?: ArtifactSceneInput[];
  /** What it is. */
  message?: string;
  /** Folder to create it in. */
  project?: Project;
}

/**
 * Artifacts: web pages agents write (HTML with its CSS, scripts, images and
 * fonts) published as Macro items people open, share, comment on, browse the
 * history of, and place on canvases one scene at a time.
 *
 * @routing Use when publishing an HTML page, a prototype, a report or any other web page as an artifact, or reading, versioning or placing one on a canvas.
 *
 * @agent
 * An artifact is a document of file type `artifact`; share, move and mention
 * it through `artifact.document()`. Pages run in a sandboxed frame on their
 * own origin with no network but their own files and the cdnjs, jsDelivr and
 * unpkg CDNs, so inline data and never call Macro or other APIs from a page.
 * Scenes are the pages people share: give each distinct state or view its
 * own scene. Hand users `artifact.webUrl()` or `scene.webUrl()`.
 */
export class ArtifactNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Publish a page as an artifact: one index.html, relative paths, only the cdnjs/jsDelivr/unpkg CDNs, :root colors redefined in [data-theme=dark], set by ?theme=.
   *
   * Pages render in a frame on the artifact's own origin, whose
   * Content-Security-Policy allows `connect-src 'self'` only: no API calls,
   * no external images or fonts except Google Fonts and the CDNs. The host
   * appends `?theme=light|dark`; read it in a tiny inline script and set
   * `document.documentElement.dataset.theme`. At most 255 files, 16 MiB each
   * and 64 MiB per version, with extensions from the allowlist (html, css, js,
   * json, md, txt, images, fonts, mp4/webm/mp3, pdf, wasm). Scene ids are
   * slugs naming one of the files.
   *
   * @example
   * const artifact = await macro.artifacts.create({
   *   name: 'Onboarding flow',
   *   files: { 'index.html': html, 'empty.html': emptyHtml },
   *   scenes: [{ id: 'empty', title: 'Empty state', path: 'empty.html' }],
   * });
   * return { url: artifact.webUrl() };
   */
  async create(options: CreateArtifactOptions): Promise<Artifact> {
    const bundle = await prepareBundle(options.files);
    const rest = {
      name: options.name,
      project_id: options.project?.id ?? null,
      scenes: sceneBodies(options.scenes),
      message: options.message ?? null,
    };
    const files = inlineFiles(bundle, rest);
    if (files) {
      return Artifact.from(
        this.client,
        unwrap(
          await this.client.storage.createArtifact({
            body: { ...rest, files },
          }),
        ),
      );
    }
    // Bytes the request can't carry go through uploads, which need the
    // artifact to exist first.
    const artifact = Artifact.from(
      this.client,
      unwrap(
        await this.client.storage.createArtifact({
          body: { name: options.name, project_id: rest.project_id },
        }),
      ),
    );
    await artifact.publish({
      files: options.files,
      scenes: options.scenes,
      message: options.message,
      baseVersion: 0,
    });
    return artifact;
  }

  /** A handle to an artifact by document id. Details load on first access. */
  byId(id: string): Artifact {
    return Artifact.byId(this.client, id);
  }
}
