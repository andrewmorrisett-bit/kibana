/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { expect } from '@kbn/scout/api';
import {
  ALERTING_V2_ALERTS_AND_CONNECTORS_ALL_ROLE,
  ALERTING_V2_ALERTS_READ_ROLE,
  apiTest,
  buildCreateImportConfigData,
  getConnectorUrl,
  getImportConfigUrl,
  testData,
} from '../fixtures';

apiTest.describe('Delete import config API', { tag: testData.API_ENGINE_TAG }, () => {
  let writerHeaders: Record<string, string>;
  let connectorId: string;

  apiTest.beforeAll(async ({ samlAuth }) => {
    const { cookieHeader } = await samlAuth.asInteractiveUser(
      ALERTING_V2_ALERTS_AND_CONNECTORS_ALL_ROLE
    );
    writerHeaders = { ...cookieHeader, ...testData.COMMON_HEADERS };
  });

  apiTest.beforeEach(async ({ apiServices }) => {
    await apiServices.alertingV2.importConfigs.cleanUp();
    ({ connector_id: connectorId } = await apiServices.alertingV2.importConfigs.create(
      buildCreateImportConfigData({ id: 'scout-import-delete' })
    ));
  });

  apiTest.afterAll(async ({ apiServices }) => {
    await apiServices.alertingV2.importConfigs.cleanUp();
  });

  apiTest('should delete the import and its connector', async ({ apiClient }) => {
    const response = await apiClient.delete(getImportConfigUrl('scout-import-delete'), {
      headers: writerHeaders,
    });

    expect(response).toHaveStatusCode(204);

    const getResponse = await apiClient.get(getImportConfigUrl('scout-import-delete'), {
      headers: writerHeaders,
    });
    expect(getResponse).toHaveStatusCode(404);

    const connectorResponse = await apiClient.get(getConnectorUrl(connectorId), {
      headers: writerHeaders,
    });
    expect(connectorResponse).toHaveStatusCode(404);
  });

  apiTest('should return 404 when no import has that id', async ({ apiClient }) => {
    const response = await apiClient.delete(getImportConfigUrl('does-not-exist'), {
      headers: writerHeaders,
    });

    expect(response).toHaveStatusCode(404);
    expect(response.body.code).toBe('IMPORT_CONFIG_NOT_FOUND');
  });

  apiTest(
    'authorization: should return 403 for a user with read-only alerts privileges',
    async ({ apiClient, samlAuth }) => {
      const { cookieHeader } = await samlAuth.asInteractiveUser(ALERTING_V2_ALERTS_READ_ROLE);

      const response = await apiClient.delete(getImportConfigUrl('scout-import-delete'), {
        headers: { ...cookieHeader, ...testData.COMMON_HEADERS },
      });

      expect(response).toHaveStatusCode(403);
    }
  );
});
