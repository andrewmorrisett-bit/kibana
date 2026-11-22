/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ImportConfigConnectorServiceContract } from './import_config_connector_service';

export type ImportConfigConnectorServiceMock = jest.Mocked<ImportConfigConnectorServiceContract>;

export const createImportConfigConnectorServiceMock = (): ImportConfigConnectorServiceMock => ({
  create: jest.fn().mockResolvedValue('connector-1'),
  delete: jest.fn().mockResolvedValue(undefined),
});
