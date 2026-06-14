import { Card } from 'client/components/Form/Card';
import Row, { ListRow } from 'client/components/Form/Row';
import { ipUrl, siteUrl } from 'client/utils/external-links';

const styles = `
  grid-row: span 2;
  .content {
    max-height: 50rem;
    overflow-x: hidden;
    overflow-y: auto;
    overflow-wrap: anywhere;
  }
`;

const DnsRecordsCard = (props: { data: any; title: string; actionButtons: any }): JSX.Element => {
  const dns = props.data;
  const mx = (dns.MX || []).map((r: any) =>
    typeof r === 'string' ? r : `${r.exchange} (priority ${r.priority})`,
  );
  const soa = dns.SOA ? [`${dns.SOA.nsname} (${dns.SOA.hostmaster})`] : [];
  return (
    <Card heading={props.title} actionButtons={props.actionButtons} styles={styles}>
      <div className="content">
        {dns.A?.length > 0 && <ListRow title="A" list={dns.A} href={ipUrl} />}
        {dns.AAAA?.length > 0 && <ListRow title="AAAA" list={dns.AAAA} href={ipUrl} />}
        {mx.length > 0 && <ListRow title="MX" list={mx} />}
        {dns.CNAME?.length > 0 && <ListRow title="CNAME" list={dns.CNAME} href={siteUrl} />}
        {dns.NS?.length > 0 && <ListRow title="NS" list={dns.NS} href={siteUrl} />}
        {dns.PTR?.length > 0 && <ListRow title="PTR" list={dns.PTR} href={siteUrl} />}
        {soa.length > 0 && <ListRow title="SOA" list={soa} />}
        {dns.SRV?.length > 0 && (
          <ListRow
            title="SRV"
            list={dns.SRV.map((r: any) => `${r.name}:${r.port} (priority ${r.priority})`)}
          />
        )}
        {dns.TXT?.length > 0 && <Row lbl="TXT" val={`${dns.TXT.length} records`} />}
      </div>
    </Card>
  );
};

export default DnsRecordsCard;
