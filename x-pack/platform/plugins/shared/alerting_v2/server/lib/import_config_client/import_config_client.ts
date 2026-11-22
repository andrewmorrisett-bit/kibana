/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import Boom from '@hapi/boom';
import type { ImportConfigData, ImportConfigResponse } from '@kbn/alerting-v2-schemas';
import {
  createImportConfigDataSchema,
  importConfigDataSchema,
  putImportConfigDataSchema,
  updateImportConfigDataSchema,
} from '@kbn/alerting-v2-schemas';
import { SavedObjectsErrorHelpers } from '@kbn/core-saved-objects-server';
import { stringifyZodError } from '@kbn/zod-helpers/v4';
import { treeifyError, type z } from '@kbn/zod/v4';
import { inject, injectable } from 'inversify';
import { withApm as withApmDecorator } from '../apm/with_apm_decorator';
import { applyPatch } from '../apply_patch';
import { buildSoSearch } from '../build_so_search';
import { ALERTING_ERROR_CODES, ALERTING_LOG_CODES } from '../errors/error_codes';
import {
  getImportConfigAlreadyExistsMessage,
  getImportConfigNotFoundMessage,
  getImportConfigVersionConflictMessage,
  getInvalidImportConfigDataMessage,
  type ImportConfigValidationContext,
} from '../errors/import_config_error_messages';
import {
  ImportConfigConnectorService,
  type ImportConfigConnectorServiceContract,
} from '../services/import_config_connector_service/import_config_connector_service';
import { ImportConfigSavedObjectServiceScopedToken } from '../services/import_config_saved_object_service/tokens';
import type {
  ImportConfigSavedObjectDoc,
  ImportConfigSavedObjectServiceContract,
} from '../services/import_config_saved_object_service/types';
import {
  LoggerServiceToken,
  type LoggerServiceContract,
} from '../services/logger_service/logger_service';
import type { Actor, UserServiceContract } from '../services/user_service/user_service';
import { UserService } from '../services/user_service/user_service';
import type {
  CreateImportConfigParams,
  FindImportConfigsParams,
  FindImportConfigsResponse,
  UpdateImportConfigParams,
  UpsertImportConfigParams,
} from './types';
import {
  buildCreateImportConfigAttributes,
  buildImportConfigReferences,
  buildUpdateImportConfigAttributes,
  getConnectorIdFromReferences,
  mapImportConfigSortField,
  toImportConfigData,
  transformImportConfigToApiResponse,
} from './utils';

const withApm = withApmDecorator('ImportConfigClient');

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;

/**
 * CRUD for alert import configs: the configuration of one source of external alerts, such as a
 * Datadog connector that receives events.
 *
 * Creating an import creates its connector, with no authentication, from the import `type`.
 * Deleting an import deletes its connector. The connector never changes in between.
 *
 * The connector is stored twice: as the `connector_id` attribute and as a `connector` saved object
 * reference. Every write sets both. Every read takes the connector id from the reference, which
 * saved object import and copy to space keep up to date, and falls back to the attribute only when
 * the reference is missing.
 */
@injectable()
export class ImportConfigClient {
  private readonly logger: LoggerServiceContract;

  constructor(
    @inject(ImportConfigSavedObjectServiceScopedToken)
    private readonly importConfigSavedObjectService: ImportConfigSavedObjectServiceContract,
    @inject(UserService) private readonly userService: UserServiceContract,
    @inject(ImportConfigConnectorService)
    private readonly connectorService: ImportConfigConnectorServiceContract,
    @inject(LoggerServiceToken) loggerService: LoggerServiceContract
  ) {
    this.logger = loggerService.forSubsystem('importConfigClient');
  }

  @withApm
  public async createImportConfig(params: CreateImportConfigParams): Promise<ImportConfigResponse> {
    const { id, type, ...data } = this.parseImportConfigData(
      createImportConfigDataSchema,
      params.data,
      'create'
    );
    const actor = await this.userService.getCurrentActor();
    const connectorId = await this.connectorService.create({ type, name: data.metadata.name });
    const attributes = buildCreateImportConfigAttributes({
      data,
      connectorId,
      actor,
      now: new Date().toISOString(),
    });

    let createdId: string;
    try {
      ({ id: createdId } = await this.importConfigSavedObjectService.create({
        attrs: attributes,
        references: buildImportConfigReferences(connectorId),
        id,
      }));
    } catch (e) {
      await this.deleteConnectorQuietly(connectorId, id);
      if (id && SavedObjectsErrorHelpers.isConflictError(e)) {
        throw Boom.conflict(getImportConfigAlreadyExistsMessage(id), {
          code: ALERTING_ERROR_CODES.IMPORT_CONFIG_ALREADY_EXISTS,
          details: { import_config_id: id },
        });
      }
      throw e;
    }

    return transformImportConfigToApiResponse({
      id: createdId,
      attributes,
      connectorId,
    });
  }

  @withApm
  public async getImportConfig({ id }: { id: string }): Promise<ImportConfigResponse> {
    const doc = await this.getExistingImportConfig(id);
    return transformImportConfigToApiResponse({
      id: doc.id,
      attributes: doc.attributes,
      connectorId: this.resolveConnectorId(doc),
    });
  }

  @withApm
  public async updateImportConfig(params: UpdateImportConfigParams): Promise<ImportConfigResponse> {
    const patch = this.parseImportConfigData(updateImportConfigDataSchema, params.data, 'update');
    const actor = await this.userService.getCurrentActor();
    const existing = await this.getExistingImportConfig(params.id);

    const merged = applyPatch(
      importConfigDataSchema,
      toImportConfigData(existing.attributes),
      patch
    );
    const data = this.parseImportConfigData(importConfigDataSchema, merged, 'update');

    return this.replaceImportConfig({ existing, data, actor });
  }

  /**
   * Creates the import config at `id`, with its connector, when it does not exist. Otherwise
   * replaces it with `data` and keeps its connector.
   */
  @withApm
  public async upsertImportConfig(
    params: UpsertImportConfigParams
  ): Promise<{ importConfig: ImportConfigResponse; created: boolean }> {
    // `type` only picks the connector type, so a replace does not use it.
    const { type, ...data } = this.parseImportConfigData(
      putImportConfigDataSchema,
      params.data,
      'upsert'
    );
    const existing = await this.findImportConfig(params.id);

    if (!existing) {
      const importConfig = await this.createImportConfig({
        data: { ...data, type, id: params.id },
      });
      return { importConfig, created: true };
    }

    const actor = await this.userService.getCurrentActor();
    const importConfig = await this.replaceImportConfig({ existing, data, actor });
    return { importConfig, created: false };
  }

  @withApm
  public async deleteImportConfig({ id }: { id: string }): Promise<void> {
    const existing = await this.getExistingImportConfig(id);
    try {
      await this.importConfigSavedObjectService.delete({ id });
    } catch (e) {
      throw this.mapNotFound(id, e);
    }
    await this.deleteConnectorQuietly(this.resolveConnectorId(existing), id);
  }

  @withApm
  public async findImportConfigs(
    params: FindImportConfigsParams = {}
  ): Promise<FindImportConfigsResponse> {
    const page = params.page ?? DEFAULT_PAGE;
    const perPage = params.perPage ?? DEFAULT_PER_PAGE;

    const result = await this.importConfigSavedObjectService.find({
      page,
      perPage,
      search: buildSoSearch(params.search),
      sortField: mapImportConfigSortField(params.sortField),
      sortOrder: params.sortOrder,
      connectorId: params.connectorId,
    });

    return {
      items: result.saved_objects.map((doc) =>
        transformImportConfigToApiResponse({
          id: doc.id,
          attributes: doc.attributes,
          connectorId: this.resolveConnectorId(doc),
        })
      ),
      total: result.total,
      page,
      per_page: perPage,
    };
  }

  /**
   * Validates input with a Zod schema and throws a uniform `Boom.badRequest` on failure, so create
   * and update report validation issues the same way.
   */
  private parseImportConfigData<T>(
    schema: z.ZodType<T>,
    data: unknown,
    context: ImportConfigValidationContext
  ): T {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw Boom.badRequest(
        getInvalidImportConfigDataMessage(context, stringifyZodError(parsed.error)),
        {
          code: ALERTING_ERROR_CODES.INVALID_IMPORT_CONFIG_DATA,
          details: { context, errors: treeifyError(parsed.error) },
        }
      );
    }
    return parsed.data;
  }

  private async getExistingImportConfig(id: string): Promise<ImportConfigSavedObjectDoc> {
    try {
      return await this.importConfigSavedObjectService.get(id);
    } catch (e) {
      throw this.mapNotFound(id, e);
    }
  }

  /** Returns the import config, or `undefined` when it does not exist. */
  private async findImportConfig(id: string): Promise<ImportConfigSavedObjectDoc | undefined> {
    try {
      return await this.importConfigSavedObjectService.get(id);
    } catch (e) {
      if (e instanceof Error && SavedObjectsErrorHelpers.isNotFoundError(e)) {
        return undefined;
      }
      throw e;
    }
  }

  /**
   * Deletes an import's connector without failing the request: the import write it belongs to has
   * already failed or succeeded, so a leftover connector is logged instead.
   */
  private async deleteConnectorQuietly(
    connectorId: string,
    importConfigId?: string
  ): Promise<void> {
    try {
      await this.connectorService.delete(connectorId);
    } catch (e) {
      this.logger.warn({
        message: 'Failed to delete the connector of an import config',
        code: ALERTING_LOG_CODES.IMPORT_CONFIG_CONNECTOR_DELETE_FAILED,
        labels: { connector_id: connectorId, import_config_id: importConfigId },
        error: e,
      });
    }
  }

  /** Writes `data` over an existing import config, guarded by its saved object version. */
  private async replaceImportConfig({
    existing,
    data,
    actor,
  }: {
    existing: ImportConfigSavedObjectDoc;
    data: ImportConfigData;
    actor: Actor | null;
  }): Promise<ImportConfigResponse> {
    const connectorId = this.resolveConnectorId(existing);
    const attributes = buildUpdateImportConfigAttributes({
      existing: existing.attributes,
      data,
      connectorId,
      actor,
      now: new Date().toISOString(),
    });

    try {
      await this.importConfigSavedObjectService.update({
        id: existing.id,
        attrs: attributes,
        references: buildImportConfigReferences(connectorId),
        version: existing.version,
      });
    } catch (e) {
      if (SavedObjectsErrorHelpers.isConflictError(e)) {
        throw Boom.conflict(getImportConfigVersionConflictMessage(existing.id), {
          code: ALERTING_ERROR_CODES.IMPORT_CONFIG_VERSION_CONFLICT,
          details: { import_config_id: existing.id },
        });
      }
      throw e;
    }

    return transformImportConfigToApiResponse({
      id: existing.id,
      attributes,
      connectorId,
    });
  }

  private mapNotFound(id: string, e: unknown): unknown {
    if (e instanceof Error && SavedObjectsErrorHelpers.isNotFoundError(e)) {
      return Boom.notFound(getImportConfigNotFoundMessage(id), {
        code: ALERTING_ERROR_CODES.IMPORT_CONFIG_NOT_FOUND,
        details: { import_config_id: id },
      });
    }
    return e;
  }

  /**
   * Returns the connector id from the `connector` reference. A missing reference is logged and
   * the stored attribute is used instead, since it is the only other copy.
   */
  private resolveConnectorId(doc: ImportConfigSavedObjectDoc): string {
    const connectorId = getConnectorIdFromReferences(doc.references);
    if (connectorId !== undefined) {
      return connectorId;
    }

    this.logger.warn({
      message: 'Import config has no connector reference; using the stored connector id',
      code: ALERTING_LOG_CODES.IMPORT_CONFIG_CONNECTOR_REFERENCE_NOT_FOUND,
      labels: { import_config_id: doc.id, connector_id: doc.attributes.connector_id },
    });
    return doc.attributes.connector_id;
  }
}
