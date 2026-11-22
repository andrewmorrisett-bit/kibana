/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KbnClient, ScoutLogger } from '@kbn/scout';
import { measurePerformanceAsync } from '@kbn/scout';
import type { CreateImportConfigData, ImportConfigResponse } from '@kbn/alerting-v2-schemas';
import {
  COMMON_HEADERS,
  IMPORT_CONFIG_API_PATH,
  IMPORT_CONFIG_SAVED_OBJECT_TYPE,
} from '../constants';
import { getImportConfigUrl } from '../urls';

export interface ImportConfigsApiService {
  create: (data: CreateImportConfigData) => Promise<ImportConfigResponse>;
  /** Whether an import config saved object with this id exists. */
  exists: (id: string) => Promise<boolean>;
  /** Deletes every import config and the connector each one created. */
  cleanUp: () => Promise<void>;
}

const isNotFound = (error: unknown): boolean =>
  (error as { status?: number } | undefined)?.status === 404;

/**
 * Seeds import configs through the create route, which also creates their connectors, and
 * deletes them through the delete route so their connectors go too.
 */
export const getImportConfigsApiService = ({
  log,
  kbnClient,
}: {
  log: ScoutLogger;
  kbnClient: KbnClient;
}): ImportConfigsApiService => ({
  create: (data) =>
    measurePerformanceAsync(log, 'importConfigs.create', async () => {
      const response = await kbnClient.request<ImportConfigResponse>({
        method: 'POST',
        path: IMPORT_CONFIG_API_PATH,
        headers: COMMON_HEADERS,
        body: data,
      });
      return response.data;
    }),

  exists: (id) =>
    measurePerformanceAsync(log, 'importConfigs.exists', async () => {
      try {
        await kbnClient.savedObjects.get({ type: IMPORT_CONFIG_SAVED_OBJECT_TYPE, id });
        return true;
      } catch (error) {
        if (isNotFound(error)) {
          return false;
        }
        throw error;
      }
    }),

  cleanUp: () =>
    measurePerformanceAsync(log, 'importConfigs.cleanUp', async () => {
      const { saved_objects: savedObjects } = await kbnClient.savedObjects.find({
        type: IMPORT_CONFIG_SAVED_OBJECT_TYPE,
      });
      for (const { id } of savedObjects) {
        await kbnClient.request({
          method: 'DELETE',
          path: getImportConfigUrl(id),
          headers: COMMON_HEADERS,
        });
      }
      // Removes any import config the delete route could not reach.
      await kbnClient.savedObjects.clean({ types: [IMPORT_CONFIG_SAVED_OBJECT_TYPE] });
    }),
});
