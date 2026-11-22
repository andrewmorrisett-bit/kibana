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

export interface ImportConfigsApiService {
  create: (data: CreateImportConfigData) => Promise<ImportConfigResponse>;
  cleanUp: () => Promise<void>;
}

/** Seeds import configs through the create route and removes every `alerting_import_config` saved object. */
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

  cleanUp: () =>
    measurePerformanceAsync(log, 'importConfigs.cleanUp', async () => {
      await kbnClient.savedObjects.clean({ types: [IMPORT_CONFIG_SAVED_OBJECT_TYPE] });
    }),
});
