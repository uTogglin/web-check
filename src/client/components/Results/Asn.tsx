import { Card } from 'client/components/Form/Card';
import Row, { ExpandableRow, type RowProps } from 'client/components/Form/Row';
import Heading from 'client/components/Form/Heading';
import colors from 'client/styles/colors';

// Each neighbour is { asn, power } — power = how many route collectors observe it
const asnRows = (list: any[]): RowProps[] =>
  list.map((a) => ({ lbl: `AS${a.asn}`, val: a.power ? `${a.power}×` : ' ' }));

const countLabel = (group: any) =>
  `${group?.count ?? 0}${group?.truncated ? ` (showing ${group.list.length})` : ''}`;

const AsnCard = (props: { data: any; title: string; actionButtons: any }): JSX.Element => {
  const d = props.data;
  const asn = d?.asn ?? {};
  const peers = d?.peers ?? { count: 0, list: [] };
  const upstreams = d?.upstreams ?? { count: 0, list: [] };
  const downstreams = d?.downstreams ?? { count: 0, list: [] };
  const prefixes = d?.announcedPrefixes ?? { count: 0, list: [] };

  const summary = [
    { lbl: 'IP Address', val: d?.ip },
    { lbl: 'Routed Prefix', val: d?.prefix },
    { lbl: 'ASN', val: asn.number ? `AS${asn.number}` : null },
    { lbl: 'Network', val: asn.holder },
    { lbl: 'Allocation', val: asn.block },
  ].filter((r) => r.val);

  return (
    <Card heading={props.title} actionButtons={props.actionButtons}>
      {summary.map((r) => (
        <Row lbl={r.lbl} val={`${r.val}`} key={r.lbl} />
      ))}
      {Array.isArray(d?.asns) && d.asns.length > 1 && (
        <Row lbl="Origin ASNs" val={d.asns.map((a: any) => `AS${a}`).join(', ')} />
      )}

      <Heading as="h4" size="small" align="left" color={colors.primary}>
        Peering & Routing
      </Heading>

      <ExpandableRow
        lbl="Upstreams (Transit)"
        val={countLabel(upstreams)}
        rowList={asnRows(upstreams.list)}
        title="Provider networks this AS routes through to reach the wider internet"
      />
      <ExpandableRow
        lbl="Peers"
        val={countLabel(peers)}
        rowList={asnRows(peers.list)}
        title="Networks that exchange traffic with this AS as equals"
      />
      <ExpandableRow
        lbl="Downstreams (Customers)"
        val={countLabel(downstreams)}
        rowList={asnRows(downstreams.list)}
        title="Networks that receive transit from this AS"
      />
      <ExpandableRow
        lbl="Announced Prefixes"
        val={`${(prefixes.v4Count ?? 0) + (prefixes.v6Count ?? 0)} (${prefixes.v4Count ?? 0} v4 / ${prefixes.v6Count ?? 0} v6)`}
        rowList={(prefixes.list || []).map((p: string) => ({ lbl: p, val: ' ' }))}
        title="All IP ranges this AS advertises to the global routing table"
      />
    </Card>
  );
};

export default AsnCard;
