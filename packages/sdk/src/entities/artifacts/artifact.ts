import type {
  ArtifactResponse,
  ArtifactVersionResponse,
  ArtifactVersionSummaryResponse,
  SceneBody,
} from '../../../generated/storage/types.gen';
import { Lazy, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Agent } from '../agents/agent';
import { Document } from '../documents/document';
import { FavoritableEntity } from '../entity';
import { User } from '../users/user';
import {
  type ArtifactFiles,
  type ArtifactSceneInput,
  prepareBundle,
  sceneBodies,
  stageBundle,
} from './bundle';

/** Gateway failures after which a placement may or may not have applied. */
const RETRIED_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Width and height the canvas UI gives an artifact it inserts. */
const DEFAULT_PLACEMENT = { width: 960, height: 600 };

/** Publish a new version of an artifact. */
export interface PublishArtifactOptions {
  /** Every file of the version by relative path; `index.html` is required. */
  files: ArtifactFiles;
  /** Named pages of the version. */
  scenes?: ArtifactSceneInput[];
  /** What changed. */
  message?: string;
  /**
   * The version this one builds on (0 before the first publish). Publishing
   * fails with a 409 when someone published since, instead of overwriting
   * their version.
   */
  baseVersion?: ArtifactVersion | number;
}

/** Where to place an artifact on a canvas, in canvas world units. */
export interface PlaceArtifactOptions {
  /** The scene to show; the artifact's `index.html` when omitted. */
  scene?: ArtifactScene;
  /** X of the node's top-left corner. */
  x: number;
  /** Y of the node's top-left corner. */
  y: number;
  /** Node width; 960, as the canvas UI inserts artifacts, when omitted. */
  width?: number;
  /** Node height; 600 when omitted. */
  height?: number;
}

/** One file of a version. */
export interface ArtifactFile {
  /** Relative path, e.g. `scenes/empty.html`. */
  path: string;
  /** Hex SHA-256 of the bytes. */
  sha256: string;
  /** Size in bytes. */
  size: number;
  /** Content type. */
  contentType: string;
}

/** An artifact placed on a canvas as an embedded document node. */
export interface ArtifactPlacement {
  /** The canvas it was placed on. */
  canvas: Document;
  /** The artifact placed. */
  artifact: Artifact;
  /** The scene shown, when one was placed. */
  scene?: ArtifactScene;
  /** The canvas item id of the new node, as `ReadCanvas` reports it. */
  itemId: string;
}

/**
 * An agent-written web page published as a Macro item: files (HTML, CSS,
 * scripts, images, fonts) in immutable numbered versions, with named scenes.
 * It is a document, so share it with {@link Artifact.document}.
 */
export class Artifact extends FavoritableEntity<ArtifactResponse> {
  /** Artifacts are documents to the favorites API. */
  readonly entityType = 'document';

  /** The artifact's name. */
  readonly name = this.field('name');

  protected async fetch(): Promise<ArtifactResponse> {
    return unwrap(
      await this.client.storage.getArtifact({
        path: { document_id: this.id },
      }),
    );
  }

  /** A handle to an artifact by document id. Details load on first access. */
  static byId(client: MacroClient, id: string): Artifact {
    return new Artifact(client, id);
  }

  /** @internal Seed from a create response. */
  static from(client: MacroClient, response: ArtifactResponse): Artifact {
    return new Artifact(client, response.document_id, response);
  }

  /** The artifact as a document, for sharing, moving, comments and mentions. */
  document(): Document {
    return Document.byId(this.client, this.id);
  }

  /** The newest version, or `undefined` before the first publish. */
  async currentVersion(): Promise<ArtifactVersion | undefined> {
    const { current } = await this.detail.get();
    return current
      ? ArtifactVersion.from(this.client, this, current)
      : undefined;
  }

  /**
   * Publish the next version. Files this artifact already stores (earlier
   * versions, copies) go by digest and cost nothing; new bytes go inline while
   * the request fits 32 MiB, otherwise through presigned uploads, which code
   * mode cannot reach, so keep a code-mode version's new bytes under 32 MiB.
   *
   * @example
   * await artifact.publish({
   *   files: { 'index.html': html, 'app.css': css },
   *   baseVersion: await artifact.currentVersion(),
   *   message: 'Add the empty state',
   * });
   */
  async publish(options: PublishArtifactOptions): Promise<ArtifactVersion> {
    const bundle = await prepareBundle(options.files);
    const rest = {
      scenes: sceneBodies(options.scenes),
      message: options.message ?? null,
      base_version:
        options.baseVersion === undefined
          ? null
          : typeof options.baseVersion === 'number'
            ? options.baseVersion
            : options.baseVersion.number,
    };
    const files = await stageBundle(this.client, this, bundle, rest);
    const version = await this.mutate((client) =>
      client.storage.publishArtifactVersion({
        path: { document_id: this.id },
        body: { ...rest, files },
      }),
    );
    return ArtifactVersion.from(this.client, this, version);
  }

  /** Every version, newest first. */
  async versions(): Promise<ArtifactVersion[]> {
    const { versions } = unwrap(
      await this.client.storage.listArtifactVersions({
        path: { document_id: this.id },
      }),
    );
    return versions.map((summary) =>
      ArtifactVersion.fromSummary(this.client, this, summary),
    );
  }

  /** Version `number` (1, 2, 3 …). */
  async version(number: number): Promise<ArtifactVersion> {
    return ArtifactVersion.from(
      this.client,
      this,
      unwrap(
        await this.client.storage.getArtifactVersion({
          path: { document_id: this.id, number },
        }),
      ),
    );
  }

  /**
   * Publish an old version's files and scenes again as the newest version.
   * History is never rewritten.
   */
  async restore(version: ArtifactVersion): Promise<ArtifactVersion> {
    const restored = await this.mutate((client) =>
      client.storage.restoreArtifactVersion({
        path: { document_id: this.id, number: version.number },
      }),
    );
    return ArtifactVersion.from(this.client, this, restored);
  }

  /** The current version's scenes; none before the first publish. */
  async scenes(): Promise<ArtifactScene[]> {
    return (await (await this.currentVersion())?.scenes()) ?? [];
  }

  /** The artifact's page in the Macro web app; give users this link. */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/artifact/${this.id}`;
  }

  /** The artifact's page in the web app, opened at `scene`. */
  sceneUrl(scene: ArtifactScene): string {
    return `${this.webUrl()}?scene=${encodeURIComponent(scene.id)}`;
  }

  /**
   * Place the artifact, or one scene, on a canvas you can edit, as the
   * embedded document node the canvas UI inserts, recording the canvas's
   * reference to it. The node follows the artifact's current version. A
   * lost response is retried once with the same item id, which never places
   * a second node.
   *
   * @example
   * const [empty] = await artifact.scenes();
   * await artifact.placeOn(macro.documents.byId(canvasId), {
   *   scene: empty,
   *   x: 0,
   *   y: 0,
   * });
   */
  async placeOn(
    canvas: Document,
    options: PlaceArtifactOptions,
  ): Promise<ArtifactPlacement> {
    // One item id per call: a retry after a lost response converges on the
    // same node and reference instead of placing the artifact twice.
    const body = {
      item_id: crypto.randomUUID(),
      canvas_id: canvas.id,
      scene: options.scene?.id ?? null,
      x: options.x,
      y: options.y,
      width: options.width ?? DEFAULT_PLACEMENT.width,
      height: options.height ?? DEFAULT_PLACEMENT.height,
    };
    const place = () =>
      this.client.storage.placeArtifact({
        path: { document_id: this.id },
        body,
      });
    const placed = await place().then(
      (result) =>
        RETRIED_STATUSES.has(result.response?.status ?? 0) ? place() : result,
      // The request failed in transit, so it may have applied.
      () => place(),
    );
    const { item_id } = unwrap(placed);
    return { canvas, artifact: this, scene: options.scene, itemId: item_id };
  }

  /** Identity, loaded detail and {@link webUrl}. */
  override toJSON() {
    return { ...super.toJSON(), url: this.webUrl() };
  }
}

/** An immutable published version of an artifact. */
export class ArtifactVersion {
  private readonly detail: Lazy<ArtifactVersionResponse>;

  private constructor(
    client: MacroClient,
    /** The artifact it belongs to. */
    readonly artifact: Artifact,
    /** 1, 2, 3 … per artifact. */
    readonly number: number,
    /** What changed. */
    readonly message: string | undefined,
    /** The user who published it. */
    readonly createdBy: User,
    /** The agent that published it for them, if any. */
    readonly createdByAgent: Agent | undefined,
    /** Publish time. */
    readonly createdAt: Date,
    /** Number of files. */
    readonly fileCount: number,
    /** All files' bytes together. */
    readonly totalSize: number,
    detail?: ArtifactVersionResponse,
  ) {
    this.detail = new Lazy(
      async () =>
        unwrap(
          await client.storage.getArtifactVersion({
            path: { document_id: artifact.id, number },
          }),
        ),
      detail,
    );
  }

  /** @internal Built from a version response. */
  static from(
    client: MacroClient,
    artifact: Artifact,
    version: ArtifactVersionResponse,
  ): ArtifactVersion {
    return new ArtifactVersion(
      client,
      artifact,
      version.number,
      version.message ?? undefined,
      User.byId(client, version.created_by),
      version.created_by_agent
        ? Agent.byId(client, version.created_by_agent)
        : undefined,
      new Date(version.created_at),
      version.files.length,
      version.files.reduce((sum, file) => sum + file.size, 0),
      version,
    );
  }

  /** @internal Built from a history entry; files load on first access. */
  static fromSummary(
    client: MacroClient,
    artifact: Artifact,
    summary: ArtifactVersionSummaryResponse,
  ): ArtifactVersion {
    return new ArtifactVersion(
      client,
      artifact,
      summary.number,
      summary.message ?? undefined,
      User.byId(client, summary.created_by),
      summary.created_by_agent
        ? Agent.byId(client, summary.created_by_agent)
        : undefined,
      new Date(summary.created_at),
      summary.file_count,
      summary.total_size,
    );
  }

  /** The version's files, sorted by path. */
  async files(): Promise<ArtifactFile[]> {
    return (await this.detail.get()).files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      size: file.size,
      contentType: file.content_type,
    }));
  }

  /** The version's scenes, in display order. */
  async scenes(): Promise<ArtifactScene[]> {
    return (await this.detail.get()).scenes.map(
      (scene) => new ArtifactScene(this.artifact, this.number, scene),
    );
  }

  /** Publish this version again as the artifact's newest version. */
  restore(): Promise<ArtifactVersion> {
    return this.artifact.restore(this);
  }

  /** Serialize the version without its client. */
  toJSON() {
    return {
      artifact: this.artifact.id,
      number: this.number,
      message: this.message,
      createdBy: this.createdBy.id,
      createdByAgent: this.createdByAgent?.id,
      createdAt: this.createdAt.toISOString(),
      fileCount: this.fileCount,
      totalSize: this.totalSize,
    };
  }
}

/** A named page of an artifact version: what people share and place on canvases. */
export class ArtifactScene {
  /** Slug, unique in its version. */
  readonly id: string;
  /** Display title. */
  readonly title: string;
  /** The page's file path. */
  readonly path: string;

  /** @internal Built from a version's scene. */
  constructor(
    /** The artifact it belongs to. */
    readonly artifact: Artifact,
    /** The version number it was read from. */
    readonly version: number,
    scene: SceneBody,
  ) {
    this.id = scene.id;
    this.title = scene.title;
    this.path = scene.path;
  }

  /** The scene's page in the Macro web app; give users this link. */
  webUrl(): string {
    return this.artifact.sceneUrl(this);
  }

  /** Serialize the scene with its link. */
  toJSON() {
    return {
      artifact: this.artifact.id,
      version: this.version,
      id: this.id,
      title: this.title,
      path: this.path,
      url: this.webUrl(),
    };
  }
}
