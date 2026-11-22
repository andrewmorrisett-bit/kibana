/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  errorResponseSchema,
  importConfigResponseSchema,
  putImportConfigDataSchema,
  type PutImportConfigData,
} from '@kbn/alerting-v2-schemas';
import { Request } from '@kbn/core-di-server';
import type { KibanaRequest, RouteSecurity } from '@kbn/core-http-server';
import type { z } from '@kbn/zod/v4';
import { inject, injectable } from 'inversify';
import { ImportConfigClient } from '../../lib/import_config_client';
import { ALERTING_V2_API_PRIVILEGES } from '../../lib/security/privileges';
import { AlertingRouteContext } from '../alerting_route_context';
import { BaseAlertingRoute } from '../base_alerting_route';
import { ALERTING_V2_INTERNAL_IMPORT_CONFIG_API_PATH } from '../constants';
import { INVALID_SCHEMA_OR_PARAMETERS_DESCRIPTION } from '../route_descriptions';
import { IMPORT_CONFIG_UPSERT_CONFLICT_DESCRIPTION } from './import_config_route_descriptions';
import { importConfigIdParamsSchema } from './route_schemas';

@injectable()
export class UpsertImportConfigRoute extends BaseAlertingRoute {
  static method = 'put' as const;
  static path = `${ALERTING_V2_INTERNAL_IMPORT_CONFIG_API_PATH}/{id}`;
  static security: RouteSecurity = {
    authz: {
      requiredPrivileges: [ALERTING_V2_API_PRIVILEGES.alerts.write],
    },
  };
  static routeOptions = {
    access: 'internal' as const,
    summary: 'Create or replace an import',
    description:
      'Creates an import with the given ID, or replaces it if one already exists. Replacing an import cannot change its connector.',
  } as const;
  static schemas = {
    request: {
      body: putImportConfigDataSchema,
      params: importConfigIdParamsSchema,
    },
    response: {
      200: {
        body: () => importConfigResponseSchema,
        description: 'Returns the replaced import.',
      },
      201: {
        body: () => importConfigResponseSchema,
        description: 'Returns the newly created import.',
      },
      400: {
        body: () => errorResponseSchema,
        description: INVALID_SCHEMA_OR_PARAMETERS_DESCRIPTION,
      },
      409: {
        body: () => errorResponseSchema,
        description: IMPORT_CONFIG_UPSERT_CONFLICT_DESCRIPTION,
      },
    },
  };

  protected readonly routeName = 'upsert import config';

  constructor(
    @inject(AlertingRouteContext) ctx: AlertingRouteContext,
    @inject(Request)
    private readonly request: KibanaRequest<
      z.infer<typeof importConfigIdParamsSchema>,
      unknown,
      PutImportConfigData
    >,
    @inject(ImportConfigClient) private readonly importConfigClient: ImportConfigClient
  ) {
    super(ctx);
  }

  protected async execute() {
    const { importConfig, created } = await this.importConfigClient.upsertImportConfig({
      id: this.request.params.id,
      data: this.request.body,
    });
    return created
      ? this.ctx.response.created({ body: importConfig })
      : this.ctx.response.ok({ body: importConfig });
  }
}
