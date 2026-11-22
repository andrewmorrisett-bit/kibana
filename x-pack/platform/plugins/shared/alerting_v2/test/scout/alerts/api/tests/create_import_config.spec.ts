/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { expect } from '@kbn/scout/api';
import {
  ALERTING_V2_ALERTS_ALL_ROLE,
  ALERTING_V2_ALERTS_READ_ROLE,
  apiTest,
  buildCreateImportConfigData,
  getImportConfigUrl,
  getListImportConfigsUrl,
  NO_ACCESS_ROLE,
  testData,
} from '../fixtures';

apiTest.describe('Create import config API', { tag: testData.API_ENGINE_TAG }, () => {
  let writerHeaders: Record<string, string>;

  apiTest.beforeAll(async ({ samlAuth }) => {
    const { cookieHeader } = await samlAuth.asInteractiveUser(ALERTING_V2_ALERTS_ALL_ROLE);
    writerHeaders = { ...cookieHeader, ...testData.COMMON_HEADERS };
  });

  apiTest.beforeEach(async ({ apiServices }) => {
    await apiServices.alertingV2.importConfigs.cleanUp();
  });

  apiTest.afterAll(async ({ apiServices }) => {
    await apiServices.alertingV2.importConfigs.cleanUp();
  });

  apiTest(
    'should create an import with a generated id and not return the type',
    async ({ apiClient }) => {
      const data = buildCreateImportConfigData();

      const response = await apiClient.post(getListImportConfigsUrl(), {
        headers: writerHeaders,
        body: data,
      });

      expect(response).toHaveStatusCode(201);
      expect(typeof response.body.id).toBe('string');
      expect(response.body).toMatchObject({
        kind: data.kind,
        metadata: data.metadata,
        connector_id: data.connector_id,
        version: 1,
      });
      expect(Object.keys(response.body)).not.toContain('type');

      const getResponse = await apiClient.get(getImportConfigUrl(response.body.id), {
        headers: writerHeaders,
      });
      expect(getResponse).toHaveStatusCode(200);
      expect(getResponse.body).toStrictEqual(response.body);
    }
  );

  apiTest('should create an import with the supplied id', async ({ apiClient }) => {
    const response = await apiClient.post(getListImportConfigsUrl(), {
      headers: writerHeaders,
      body: buildCreateImportConfigData({ id: 'scout-import-custom-id' }),
    });

    expect(response).toHaveStatusCode(201);
    expect(response.body.id).toBe('scout-import-custom-id');
  });

  apiTest('should return 409 when the id is already taken', async ({ apiClient, apiServices }) => {
    await apiServices.alertingV2.importConfigs.create(
      buildCreateImportConfigData({ id: 'scout-import-taken' })
    );

    const response = await apiClient.post(getListImportConfigsUrl(), {
      headers: writerHeaders,
      body: buildCreateImportConfigData({
        id: 'scout-import-taken',
        metadata: { name: 'Second import' },
      }),
    });

    expect(response).toHaveStatusCode(409);
    expect(response.body.code).toBe('IMPORT_CONFIG_ALREADY_EXISTS');
  });

  apiTest('should return 400 when the type is missing', async ({ apiClient }) => {
    const { type, ...withoutType } = buildCreateImportConfigData();

    const response = await apiClient.post(getListImportConfigsUrl(), {
      headers: writerHeaders,
      body: withoutType,
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest('should return 400 for an unknown type', async ({ apiClient }) => {
    const response = await apiClient.post(getListImportConfigsUrl(), {
      headers: writerHeaders,
      body: { ...buildCreateImportConfigData(), type: 'pagerduty' },
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest('should return 400 for routing tags on a signal import', async ({ apiClient }) => {
    const response = await apiClient.post(getListImportConfigsUrl(), {
      headers: writerHeaders,
      body: buildCreateImportConfigData({ kind: 'signal' }),
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest(
    'authorization: should return 403 for a user with read-only alerts privileges',
    async ({ apiClient, samlAuth }) => {
      const { cookieHeader } = await samlAuth.asInteractiveUser(ALERTING_V2_ALERTS_READ_ROLE);

      const response = await apiClient.post(getListImportConfigsUrl(), {
        headers: { ...cookieHeader, ...testData.COMMON_HEADERS },
        body: buildCreateImportConfigData(),
      });

      expect(response).toHaveStatusCode(403);
    }
  );

  apiTest(
    'authorization: should return 403 for a user without alerting_v2 privileges',
    async ({ apiClient, samlAuth }) => {
      const { cookieHeader } = await samlAuth.asInteractiveUser(NO_ACCESS_ROLE);

      const response = await apiClient.post(getListImportConfigsUrl(), {
        headers: { ...cookieHeader, ...testData.COMMON_HEADERS },
        body: buildCreateImportConfigData(),
      });

      expect(response).toHaveStatusCode(403);
    }
  );
});
