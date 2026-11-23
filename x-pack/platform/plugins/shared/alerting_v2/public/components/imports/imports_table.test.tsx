/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@kbn/i18n-react';
import type { ImportListItem } from '../../hooks/use_fetch_imports';
import { ImportsTable } from './imports_table';

const mockGetUrlForApp = jest.fn(
  (_appId: string, { path }: { deepLinkId: string; path: string }) =>
    `/app/management/insightsAndAlerting/triggersActionsConnectors${path}`
);

jest.mock('@kbn/core-di-browser', () => ({
  CoreStart: (key: string) => key,
  useService: () => ({ getUrlForApp: mockGetUrlForApp }),
}));

const ITEM: ImportListItem = {
  id: 'import-1',
  name: 'Datadog one',
  type: 'datadog',
  connectorId: 'connector/1',
};

const renderTable = (overrides: Partial<React.ComponentProps<typeof ImportsTable>> = {}) => {
  const props: React.ComponentProps<typeof ImportsTable> = {
    items: [ITEM],
    totalItemCount: 1,
    isLoading: false,
    pageIndex: 0,
    pageSize: 25,
    sortField: 'name',
    sortOrder: 'asc',
    searchText: '',
    onSearchChange: jest.fn(),
    onTableChange: jest.fn(),
    ...overrides,
  };
  render(
    <I18nProvider>
      <ImportsTable {...props} />
    </I18nProvider>
  );
  return props;
};

describe('ImportsTable', () => {
  it('links the Manage action of an import to its connector', async () => {
    renderTable();

    fireEvent.click(screen.getByTestId('importActionsButton-connector/1'));
    const manage = await screen.findByTestId('importsManageAction');

    expect(manage.getAttribute('href')).toBe(
      '/app/management/insightsAndAlerting/triggersActionsConnectors/connectors/connector%2F1'
    );
    expect(manage.getAttribute('target')).toBe('_blank');
    expect(mockGetUrlForApp).toHaveBeenCalledWith('management', {
      deepLinkId: 'triggersActionsConnectors',
      path: '/connectors/connector%2F1',
    });
  });

  it('shows the label of the import type', () => {
    renderTable();

    expect(within(screen.getByTestId('importsTable')).getByText('Datadog')).toBeInTheDocument();
  });

  it('reports the search text as it is typed', () => {
    const { onSearchChange } = renderTable();

    fireEvent.change(screen.getByTestId('importsListSearch'), { target: { value: 'prod' } });

    expect(onSearchChange).toHaveBeenCalledWith('prod');
  });

  it('asks for the type sort when the Type header is clicked', () => {
    const { onTableChange } = renderTable();

    fireEvent.click(screen.getByRole('button', { name: /Type/ }));

    expect(onTableChange).toHaveBeenCalledWith({
      pageIndex: 0,
      pageSize: 25,
      sortField: 'type',
      sortOrder: 'asc',
    });
  });

  it('shows the no-matches message when a search finds nothing', () => {
    renderTable({ items: [], totalItemCount: 0, searchText: 'nothing' });

    expect(screen.getByText('No imports match your search.')).toBeInTheDocument();
  });
});
