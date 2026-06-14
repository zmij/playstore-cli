/**
 * Google Play Developer API Client Wrapper
 *
 * Provides a high-level interface to the Google Play Developer API
 * using the googleapis package.
 */

import { google } from 'googleapis';
import type { androidpublisher_v3 } from 'googleapis';
import { getAuthContext, type AuthContext } from './auth.js';
import type { Track, Listing } from './types.js';

type AndroidPublisher = androidpublisher_v3.Androidpublisher;

/**
 * Google Play Developer API Client
 */
export class PlayStoreClient {
  private publisher: AndroidPublisher;
  private packageName: string;
  private currentEditId: string | null = null;

  constructor(authContext: AuthContext) {
    const auth = new google.auth.GoogleAuth({
      keyFile: authContext.keyFilePath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    this.publisher = google.androidpublisher({
      version: 'v3',
      auth,
    });

    this.packageName = authContext.packageName;
  }

  // ============================================================================
  // Edit Management
  // ============================================================================

  /**
   * Start a new edit session
   * All modifications must be done within an edit, then committed
   */
  async startEdit(): Promise<string> {
    const response = await this.publisher.edits.insert({
      packageName: this.packageName,
    });

    this.currentEditId = response.data.id || null;
    if (!this.currentEditId) {
      throw new Error('Failed to start edit session');
    }

    return this.currentEditId;
  }

  /**
   * Commit the current edit to apply changes
   */
  async commitEdit(): Promise<void> {
    if (!this.currentEditId) {
      throw new Error('No active edit session');
    }

    await this.publisher.edits.commit({
      packageName: this.packageName,
      editId: this.currentEditId,
    });

    this.currentEditId = null;
  }

  /**
   * Delete the current edit without applying changes
   */
  async deleteEdit(): Promise<void> {
    if (!this.currentEditId) {
      return;
    }

    try {
      await this.publisher.edits.delete({
        packageName: this.packageName,
        editId: this.currentEditId,
      });
    } catch {
      // Ignore errors when deleting edit
    }

    this.currentEditId = null;
  }

  /**
   * Get or create an edit ID for operations
   */
  private async ensureEdit(): Promise<string> {
    if (!this.currentEditId) {
      await this.startEdit();
    }
    return this.currentEditId!;
  }

  // ============================================================================
  // Tracks
  // ============================================================================

  /**
   * List all release tracks
   */
  async listTracks(): Promise<Track[]> {
    const editId = await this.ensureEdit();

    const response = await this.publisher.edits.tracks.list({
      packageName: this.packageName,
      editId,
    });

    return (response.data.tracks || []).map((t) => ({
      track: t.track || '',
      releases: (t.releases || []).map((r) => ({
        name: r.name || undefined,
        versionCodes: r.versionCodes?.map(String) || [],
        status: r.status || 'unknown',
        releaseNotes: r.releaseNotes?.map((n) => ({
          language: n.language || '',
          text: n.text || '',
        })),
      })),
    }));
  }

  /**
   * Get a specific track
   */
  async getTrack(track: string): Promise<Track | null> {
    const editId = await this.ensureEdit();

    try {
      const response = await this.publisher.edits.tracks.get({
        packageName: this.packageName,
        editId,
        track,
      });

      const t = response.data;
      return {
        track: t.track || '',
        releases: (t.releases || []).map((r) => ({
          name: r.name || undefined,
          versionCodes: r.versionCodes?.map(String) || [],
          status: r.status || 'unknown',
          releaseNotes: r.releaseNotes?.map((n) => ({
            language: n.language || '',
            text: n.text || '',
          })),
        })),
      };
    } catch {
      return null;
    }
  }

  /**
   * Update a track with new releases
   */
  async updateTrack(
    track: string,
    releases: Array<{
      versionCodes: string[];
      status: string;
      releaseNotes?: Array<{ language: string; text: string }>;
    }>
  ): Promise<void> {
    const editId = await this.ensureEdit();

    await this.publisher.edits.tracks.update({
      packageName: this.packageName,
      editId,
      track,
      requestBody: {
        track,
        releases: releases.map((r) => ({
          versionCodes: r.versionCodes,
          status: r.status,
          releaseNotes: r.releaseNotes?.map((n) => ({
            language: n.language,
            text: n.text,
          })),
        })),
      },
    });
  }

  // ============================================================================
  // Listings
  // ============================================================================

  /**
   * List all store listings
   */
  async listListings(): Promise<Listing[]> {
    const editId = await this.ensureEdit();

    const response = await this.publisher.edits.listings.list({
      packageName: this.packageName,
      editId,
    });

    return (response.data.listings || []).map((l) => ({
      language: l.language || '',
      title: l.title || '',
      shortDescription: l.shortDescription || '',
      fullDescription: l.fullDescription || '',
      video: l.video || '',
    }));
  }

  /**
   * Get a specific listing by language
   */
  async getListing(language: string): Promise<Listing | null> {
    const editId = await this.ensureEdit();

    try {
      const response = await this.publisher.edits.listings.get({
        packageName: this.packageName,
        editId,
        language,
      });

      const l = response.data;
      return {
        language: l.language || '',
        title: l.title || '',
        shortDescription: l.shortDescription || '',
        fullDescription: l.fullDescription || '',
        video: l.video || '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Update a store listing
   */
  async updateListing(
    language: string,
    data: Partial<{
      title: string;
      shortDescription: string;
      fullDescription: string;
      video: string;
    }>
  ): Promise<void> {
    const editId = await this.ensureEdit();

    await this.publisher.edits.listings.update({
      packageName: this.packageName,
      editId,
      language,
      requestBody: data,
    });
  }

  // ============================================================================
  // Screenshots
  // ============================================================================

  /**
   * List screenshots for a language and image type
   */
  async listScreenshots(
    language: string,
    imageType: string
  ): Promise<{ id: string; url: string }[]> {
    const editId = await this.ensureEdit();

    try {
      const response = await this.publisher.edits.images.list({
        packageName: this.packageName,
        editId,
        language,
        imageType,
      });

      return (response.data.images || []).map((img) => ({
        id: img.id || '',
        url: img.url || '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Upload a screenshot
   */
  async uploadScreenshot(
    language: string,
    imageType: string,
    imageData: Buffer,
    mimeType: string = 'image/png'
  ): Promise<string> {
    const editId = await this.ensureEdit();

    const response = await this.publisher.edits.images.upload({
      packageName: this.packageName,
      editId,
      language,
      imageType,
      media: {
        mimeType,
        body: imageData as any,
      },
    });

    return response.data.image?.id || '';
  }

  /**
   * Delete a screenshot
   */
  async deleteScreenshot(
    language: string,
    imageType: string,
    imageId: string
  ): Promise<void> {
    const editId = await this.ensureEdit();

    await this.publisher.edits.images.delete({
      packageName: this.packageName,
      editId,
      language,
      imageType,
      imageId,
    });
  }

  /**
   * Delete all screenshots for a language and image type
   */
  async deleteAllScreenshots(language: string, imageType: string): Promise<void> {
    const editId = await this.ensureEdit();

    await this.publisher.edits.images.deleteall({
      packageName: this.packageName,
      editId,
      language,
      imageType,
    });
  }

  // ============================================================================
  // App Details
  // ============================================================================

  /**
   * Get app details (contact info, default language)
   */
  async getAppDetails(): Promise<{
    contactEmail?: string;
    contactPhone?: string;
    contactWebsite?: string;
    defaultLanguage?: string;
  }> {
    const editId = await this.ensureEdit();

    const response = await this.publisher.edits.details.get({
      packageName: this.packageName,
      editId,
    });

    return {
      contactEmail: response.data.contactEmail || undefined,
      contactPhone: response.data.contactPhone || undefined,
      contactWebsite: response.data.contactWebsite || undefined,
      defaultLanguage: response.data.defaultLanguage || undefined,
    };
  }
}

/**
 * Create a Play Store client with authentication
 */
export function createClient(keyFileOverride?: string): PlayStoreClient {
  const authContext = getAuthContext(keyFileOverride);
  return new PlayStoreClient(authContext);
}
