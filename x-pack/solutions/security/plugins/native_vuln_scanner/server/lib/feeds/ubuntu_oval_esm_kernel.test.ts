/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { buildAdvisoryIndex, matchHost } from '../matcher';
import { parseUbuntuOval } from './ubuntu_oval';

const NS = 'oval:com.ubuntu.noble';

const header = `<oval_definitions xmlns="http://oval.mitre.org/XMLSchema/oval-definitions-5" xmlns:ind-def="http://oval.mitre.org/XMLSchema/oval-definitions-5#independent" xmlns:oval="http://oval.mitre.org/XMLSchema/oval-common-5" xmlns:unix-def="http://oval.mitre.org/XMLSchema/oval-definitions-5#unix" xmlns:linux-def="http://oval.mitre.org/XMLSchema/oval-definitions-5#linux"><generator><oval:timestamp>2026-11-10T00:16:52</oval:timestamp></generator>`;

const vulnerability = (id: string, cve: string, criteria: string): string => `
<definition id="${NS}:def:${id}" class="vulnerability" version="1">
  <metadata>
    <title>${cve} on Ubuntu 24.04 LTS (noble) - medium</title>
    <reference source="CVE" ref_id="${cve}" ref_url="https://www.cve.org/CVERecord?id=${cve}" />
    <description>Test description.  Update Instructions:  Run the fix. No subscription required</description>
    <advisory from="security@ubuntu.com">
      <severity>Medium</severity>
      <public_date>2026-01-01T00:00:00Z</public_date>
      <cve href="https://ubuntu.com/security/${cve}" priority="medium" public="20260101">${cve}</cve>
    </advisory>
  </metadata>
  <criteria>
    <extend_definition applicability_check="true" definition_ref="${NS}:def:100" comment="Ubuntu 24.04 LTS (noble) is installed" />
    ${criteria}
  </criteria>
</definition>`;

const packageTest = (n: string, binary: string, evr: string) => ({
  test: `<linux-def:dpkginfo_test id="${NS}:tst:${n}" version="1" check="at least one" check_existence="at_least_one_exists"><linux-def:object object_ref="${NS}:obj:${n}" /><linux-def:state state_ref="${NS}:ste:${n}" /></linux-def:dpkginfo_test>`,
  object: `<linux-def:dpkginfo_object id="${NS}:obj:${n}" version="1"><linux-def:name var_ref="${NS}:var:${n}" var_check="at least one" /></linux-def:dpkginfo_object>`,
  state: `<linux-def:dpkginfo_state id="${NS}:ste:${n}" version="1"><linux-def:evr datatype="debian_evr_string" operation="less than">${evr}</linux-def:evr></linux-def:dpkginfo_state>`,
  variable: `<constant_variable id="${NS}:var:${n}" version="1" datatype="string"><value>${binary}</value></constant_variable>`,
});

const running = (n: string, flavourSuffix: string) => ({
  test: `<unix-def:uname_test id="${NS}:tst:${n}" version="1" check="at least one" check_existence="at_least_one_exists"><unix-def:object object_ref="${NS}:obj:200" /><unix-def:state state_ref="${NS}:ste:${n}" /></unix-def:uname_test>`,
  state: `<unix-def:uname_state id="${NS}:ste:${n}" version="1"><unix-def:os_release operation="pattern match">6\\.8\\.0\\-\\d+(\\-${flavourSuffix})</unix-def:os_release></unix-def:uname_state>`,
});

const build = (): string => {
  const esm = packageTest('1001', 'foo', '1.0-1ubuntu0.1+esm1');
  const otherRelease = packageTest('1002', 'bar', '2.0-1+esm1');
  const standard = packageTest('1003', 'baz', '3.0-1ubuntu0.2');
  const azure = running('2001', 'azure');
  const gcp = running('2002', 'gcp');
  const kernelFixed = {
    test: `<ind-def:variable_test id="${NS}:tst:2003" version="1" check="all" check_existence="all_exist"><ind-def:object object_ref="${NS}:obj:210" /><ind-def:state state_ref="${NS}:ste:2003" /></ind-def:variable_test>`,
    state: `<ind-def:variable_state id="${NS}:ste:2003" version="1"><ind-def:value datatype="debian_evr_string" operation="less than">0:6.8.0-1073</ind-def:value></ind-def:variable_state>`,
  };
  const definitions = [
    `<definition id="${NS}:def:100" class="inventory" version="1"><metadata><title>Ubuntu 24.04 LTS (noble) is installed.</title></metadata><criteria><criterion test_ref="${NS}:tst:100" comment="installed" /></criteria></definition>`,
    vulnerability(
      '1001',
      'CVE-2099-0001',
      `<criteria operator="OR"><criterion test_ref="${NS}:tst:1001" comment="foo source package in esm-infra/noble, is affected and has been fixed (note: '1.0-1ubuntu0.1+esm1')." /></criteria>`
    ),
    vulnerability(
      '1002',
      'CVE-2099-0002',
      `<criteria operator="OR"><criterion test_ref="${NS}:tst:1002" comment="bar source package in esm-infra/jammy, is affected and has been fixed (note: '2.0-1+esm1')." /></criteria>`
    ),
    vulnerability(
      '1003',
      'CVE-2099-0003',
      `<criteria operator="OR"><criterion test_ref="${NS}:tst:1003" comment="baz source package in noble, is affected and has been fixed (note: '3.0-1ubuntu0.2')." /></criteria>`
    ),
    // One fixed-version test shared by two kernel flavours, as Canonical publishes it when the
    // fixed ABI is equal.
    vulnerability(
      '2001',
      'CVE-2099-0004',
      `<criteria operator="OR">
        <criteria operator="AND"><criterion test_ref="${NS}:tst:2001" comment="Is kernel 'linux-azure-6.8' running?" /><criterion test_ref="${NS}:tst:2003" comment="'linux-azure-6.8' kernel in noble was vulnerable but has been fixed (note: '6.8.0-1073.82')." /></criteria>
        <criteria operator="AND"><criterion test_ref="${NS}:tst:2002" comment="Is kernel 'linux-gcp-6.8' running?" /><criterion test_ref="${NS}:tst:2003" comment="'linux-gcp-6.8' kernel in noble was vulnerable but has been fixed (note: '6.8.0-1073.81')." /></criteria>
      </criteria>`
    ),
  ];
  return `${header}<definitions>${definitions.join('')}</definitions>
<tests>
  <ind-def:family_test id="${NS}:tst:100" version="1" check="at least one" check_existence="at_least_one_exists"><ind-def:object object_ref="${NS}:obj:100" /><ind-def:state state_ref="${NS}:ste:100" /></ind-def:family_test>
  ${[esm, otherRelease, standard].map((p) => p.test).join('')}${azure.test}${gcp.test}${kernelFixed.test}
</tests>
<objects>
  <ind-def:family_object id="${NS}:obj:100" version="1" />
  <unix-def:uname_object id="${NS}:obj:200" version="1" />
  <ind-def:variable_object id="${NS}:obj:210" version="1"><ind-def:var_ref>${NS}:var:200</ind-def:var_ref></ind-def:variable_object>
  ${[esm, otherRelease, standard].map((p) => p.object).join('')}
</objects>
<states>
  <ind-def:family_state id="${NS}:ste:100" version="1"><ind-def:family>unix</ind-def:family></ind-def:family_state>
  ${[esm, otherRelease, standard].map((p) => p.state).join('')}${azure.state}${gcp.state}${kernelFixed.state}
</states>
<variables>
  <local_variable id="${NS}:var:200" version="1" datatype="debian_evr_string"><concat><literal_component>0:</literal_component><regex_capture pattern="^([\\d|\\.]+-\\d+)[-|\\w]+$"><object_component object_ref="${NS}:obj:200" item_field="os_release" /></regex_capture></concat></local_variable>
  ${[esm, otherRelease, standard].map((p) => p.variable).join('')}
</variables></oval_definitions>`;
};

const parse = (options: { includeEsm?: boolean } = {}) =>
  parseUbuntuOval([build()], { release: 'noble', ...options });

const host = (kernelRelease: string, packages: Array<[string, string]>) => ({
  id: 'host-1',
  os: { family: 'ubuntu' as const, version: 'noble' },
  kernelRelease,
  packages: packages.map(([name, version]) => ({ name, version })),
});

describe('parseUbuntuOval Ubuntu Pro (ESM) pockets', () => {
  it('skips esm-infra and esm-apps pockets by default', async () => {
    const result = await parse();
    expect(result.records.filter((r) => r.package.name === 'foo')).toHaveLength(0);
    expect(result.skipped.other_pocket).toBe(2);
  });

  it('keeps fixes of the host release pocket from the matching ESM pocket and marks them', async () => {
    const result = await parse({ includeEsm: true });
    const foo = result.records.filter((r) => r.package.name === 'foo');
    expect(foo).toHaveLength(1);
    expect(foo[0].requires_pro).toBe('esm-infra');
    expect(foo[0].fixed_version?.raw).toBe('1.0-1ubuntu0.1+esm1');
  });

  it('still skips an ESM pocket of another release', async () => {
    const result = await parse({ includeEsm: true });
    expect(result.records.filter((r) => r.package.name === 'bar')).toHaveLength(0);
    expect(result.skipped.other_pocket).toBe(1);
  });

  it('does not mark standard-pocket fixes as requiring Pro', async () => {
    const result = await parse({ includeEsm: true });
    const baz = result.records.filter((r) => r.package.name === 'baz');
    expect(baz).toHaveLength(1);
    expect(baz[0].requires_pro).toBeUndefined();
  });

  it('carries the Pro requirement onto the finding', async () => {
    const { records } = await parse({ includeEsm: true });
    const findings = matchHost(
      host('6.8.0-1063-gcp', [['foo', '1.0-1']]),
      buildAdvisoryIndex(records)
    ).filter((f) => f.kind === 'package');
    expect(findings).toHaveLength(1);
    expect(findings[0].requiresPro).toBe('esm-infra');
    expect(findings[0].fixedVersion).toBe('1.0-1ubuntu0.1+esm1');
  });

  it('reports nothing for an ESM-only fix when ESM is off', async () => {
    const { records } = await parse();
    expect(
      matchHost(host('6.8.0-1063-gcp', [['foo', '1.0-1']]), buildAdvisoryIndex(records)).filter(
        (f) => f.kind === 'package'
      )
    ).toHaveLength(0);
  });
});

describe('parseUbuntuOval kernel flavours sharing one fixed-version test', () => {
  it('produces one record per flavour, each with its own running-kernel condition', async () => {
    const { records } = await parse();
    const kernel = records.filter((r) => r.kind === 'running_kernel');
    expect(kernel.map((r) => r.package.name).sort()).toEqual(['linux-azure-6.8', 'linux-gcp-6.8']);
    for (const record of kernel) {
      expect(record.conditions).toHaveLength(1);
      expect(record.conditions[0]).toHaveLength(1);
    }
  });

  it('labels a gcp host finding with the gcp flavour, never the azure one', async () => {
    const { records } = await parse();
    const findings = matchHost(host('6.8.0-1063-gcp', []), buildAdvisoryIndex(records));
    expect(findings).toHaveLength(1);
    expect(findings[0].package.name).toBe('linux-gcp-6.8');
    expect(findings[0].fixedVersion).toBe('0:6.8.0-1073');
  });

  it('labels an azure host finding with the azure flavour', async () => {
    const { records } = await parse();
    const findings = matchHost(host('6.8.0-1063-azure', []), buildAdvisoryIndex(records));
    expect(findings.map((f) => f.package.name)).toEqual(['linux-azure-6.8']);
  });

  it('reports nothing for a kernel already at the fixed ABI', async () => {
    const { records } = await parse();
    expect(matchHost(host('6.8.0-1073-gcp', []), buildAdvisoryIndex(records))).toHaveLength(0);
  });
});
